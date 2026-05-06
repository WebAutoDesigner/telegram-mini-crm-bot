import { CallbackButton } from "@/components/CallbackButton";
import { PriceRow } from "@/data/site";

type Props = {
  rows?: PriceRow[];
};

export function PriceTable({ rows = [] }: Props) {
  const visible = rows.filter((row) => row.name || row.price);
  if (!visible.length) return null;

  return (
    <div className="price-table">
      <h3>Стоимость</h3>
      <div className="price-table__rows">
        {visible.map((row, index) => {
          const [label, ...rest] = (row.name || "").split(":");
          return (
            <div className="price-row" key={`${row.name}-${index}`}>
              <strong>{label}</strong>
              <span>{rest.join(":").trim()}</span>
              <b>{row.price}</b>
            </div>
          );
        })}
      </div>
      <CallbackButton>Записаться</CallbackButton>
    </div>
  );
}
