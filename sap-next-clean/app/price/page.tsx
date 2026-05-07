import { CallbackButton } from "@/components/CallbackButton";
import { allPriceGroups } from "@/data/site";
import { publicPath } from "@/lib/publicPath";

export default function PricePage() {
  return (
    <section className="price-page page-pad">
      <div className="shell">
        <a className="back-link" href={publicPath("/")}>
          ← На главную
        </a>
        <h1>Цены на детейлинг автомобиля</h1>
        <div className="price-page__list">
          {allPriceGroups().map((group, index) => (
            <article className="price-group" key={`${group.service}-${group.title}-${index}`}>
              <p>{group.service}</p>
              <h2>{group.title}</h2>
              {group.rows.map((row, rowIndex) => {
                const [label, ...rest] = (row.name || "").split(":");
                return (
                  <div className="price-row" key={`${row.name}-${rowIndex}`}>
                    <strong>{label}</strong>
                    <span>{rest.join(":").trim()}</span>
                    <b>{row.price}</b>
                  </div>
                );
              })}
              <CallbackButton>Записаться</CallbackButton>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
