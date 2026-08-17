import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

interface FieldProps {
  label?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function Field({ label, error, hint, children }: FieldProps) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-sm font-medium text-slate-700">
          {label}
        </span>
      )}
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

const baseInputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-pharma-500 focus:outline-none focus:ring-1 focus:ring-pharma-500 disabled:bg-slate-100";

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function TextInput({
  label,
  error,
  hint,
  className = "",
  ...props
}: TextInputProps) {
  return (
    <Field label={label} error={error} hint={hint}>
      <input
        className={`${baseInputClass} ${error ? "border-red-500" : ""} ${className}`}
        {...props}
      />
    </Field>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function TextArea({
  label,
  error,
  hint,
  className = "",
  ...props
}: TextAreaProps) {
  return (
    <Field label={label} error={error} hint={hint}>
      <textarea
        className={`${baseInputClass} ${error ? "border-red-500" : ""} ${className}`}
        {...props}
      />
    </Field>
  );
}

interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function SelectInput({
  label,
  error,
  hint,
  className = "",
  children,
  ...props
}: SelectInputProps) {
  return (
    <Field label={label} error={error} hint={hint}>
      <select
        className={`${baseInputClass} ${error ? "border-red-500" : ""} ${className}`}
        {...props}
      >
        {children}
      </select>
    </Field>
  );
}

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Checkbox({ label, className = "", ...props }: CheckboxProps) {
  return (
    <label className={`flex items-center gap-2 ${className}`}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-pharma-600 focus:ring-pharma-500"
        {...props}
      />
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  );
}
