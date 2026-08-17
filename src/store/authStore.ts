import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { pharmaDb } from "../db";
import { verifyPassword } from "../lib/password";
import type { Role, RoleRecord } from "../types";

interface SessionUser {
  id: string;
  fullName: string;
  username: string;
  role: Role;
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
          throw new Error("Invalid username or password");
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
