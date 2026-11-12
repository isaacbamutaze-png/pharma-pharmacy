import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { pharmaDb } from "../db";
import { hashPassword, needsRehash, verifyPassword } from "../lib/password";
import type { Role, RoleRecord } from "../types";

interface SessionUser {
  id: string;
  fullName: string;
  username: string;
  role: Role;
  /** True when the account still uses a well-known default password. */
  weakPassword?: boolean;
}

const DEFAULT_PASSWORDS = new Set(["admin123", "user123"]);
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60_000;
const ATTEMPTS_KEY = "pharma-login-attempts";

type Attempts = Record<string, { count: number; lockedUntil: number }>;

function readAttempts(): Attempts {
  try {
    return JSON.parse(localStorage.getItem(ATTEMPTS_KEY) ?? "{}") as Attempts;
  } catch {
    return {};
  }
}

function writeAttempts(a: Attempts): void {
  try {
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(a));
  } catch {
    /* storage unavailable: lockout degrades to per-session only */
  }
}

interface AuthState {
  user: SessionUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,

      login: async (username, password) => {
        const normalized = username.trim().toLowerCase();

        // Slow down password guessing: 5 wrong passwords lock the account for 1 minute.
        const attempts = readAttempts();
        const entry = attempts[normalized];
        if (entry && entry.lockedUntil > Date.now()) {
          const secs = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
          throw new Error(
            `Too many failed attempts. Try again in ${secs} second${secs === 1 ? "" : "s"}.`,
          );
        }
        const user = await pharmaDb.users
          .where("username")
          .equalsIgnoreCase(normalized)
          .first();

        if (!user) {
          throw new Error("Invalid username or password");
        }
        if (user.status !== "ACTIVE") {
          throw new Error("This account is inactive. Contact the administrator.");
        }

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) {
          const prev = attempts[normalized];
          const count = (prev && prev.lockedUntil <= Date.now() ? prev.count : prev?.count ?? 0) + 1;
          attempts[normalized] = {
            count: count >= MAX_ATTEMPTS ? 0 : count,
            lockedUntil: count >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : 0,
          };
          writeAttempts(attempts);
          throw new Error("Invalid username or password");
        }
        delete attempts[normalized];
        writeAttempts(attempts);

        // Silently upgrade old single-round hashes to PBKDF2.
        if (needsRehash(user.passwordHash)) {
          await pharmaDb.users.update(user.id, {
            passwordHash: await hashPassword(password),
          });
        }

        const role = (await pharmaDb.roles.get(user.roleId)) as
          | RoleRecord
          | undefined;
        if (!role) {
          throw new Error("User role not found. Contact the administrator.");
        }

        await pharmaDb.users.update(user.id, {
          lastLogin: Date.now(),
          updatedAt: Date.now(),
        });

        set({
          user: {
            id: user.id,
            fullName: user.fullName,
            username: user.username,
            role: role.name,
            weakPassword: DEFAULT_PASSWORDS.has(password),
          },
        });
      },

      logout: async () => {
        set({ user: null });
      },
    }),
    {
      name: "pharma-auth",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user }),
    },
  ),
);

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === "ADMIN";
}
