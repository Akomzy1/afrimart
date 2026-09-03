import { CheckIcon } from "../icons";

export interface FilterCheckProps {
  label: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
}

/** One row in the filters slide-over — a cuisine, category, or "verified sellers only". */
export function FilterCheck({ label, count, checked, onChange }: FilterCheckProps) {
  return (
    <label className={`check${checked ? " on" : ""}`}>
      <span className="bx">
        <CheckIcon />
      </span>
      <span className="lb">{label}</span>
      {count !== undefined && <span className="ct">{count}</span>}
      <input type="checkbox" checked={checked} onChange={onChange} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
    </label>
  );
}
