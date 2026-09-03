export interface LangTagProps {
  language: string;
  name: string;
}

/** One alternate-name pill on product detail — SRCH-1's multilingual resolution, made visible. */
export function LangTag({ language, name }: LangTagProps) {
  return (
    <span className="langtag">
      <span className="lg">{language}</span>
      <b>{name}</b>
    </span>
  );
}
