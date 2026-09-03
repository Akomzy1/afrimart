import type { InputHTMLAttributes } from "react";
import { SearchIcon } from "../icons";

export interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

/** SRCH-1 — the multilingual, multi-spelling search field. */
export function SearchField({ label, hint, ...props }: SearchFieldProps) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="box">
        <SearchIcon />
        <input {...props} />
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
