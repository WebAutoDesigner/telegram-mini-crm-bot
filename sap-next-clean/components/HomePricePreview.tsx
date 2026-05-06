import Link from "next/link";
import { CallbackButton } from "@/components/CallbackButton";
import { servicePath, site } from "@/data/site";
import { publicPath } from "@/lib/publicPath";

function buildGroups() {
  return site.services
    .flatMap((service) =>
      (service.subservices || [])
        .filter((subservice) => (subservice.priceRows || []).some((row) => row.name || row.price))
        .map((subservice) => ({
          title: subservice.heading || subservice.title || service.title,
          image: subservice.images?.find((item) => item.image)?.image || service.image,
          href: servicePath(service),
          rows: subservice.priceRows || []
        }))
    )
    .slice(0, 4);
}

export function HomePricePreview() {
  const groups = buildGroups();
  if (!groups.length) return null;

  return (
    <section className="home-price">
      <div className="shell">
        <div className="home-price__head">
          <h2>ПРАЙС-ЛИСТ:</h2>
          <p>
            Профессиональный подход и высокое качество выполняемых работ, вежливое общение, приятный и дружелюбный
            сервис в скандинавском стиле.
          </p>
        </div>
        <div className="home-price__list">
          {groups.map((group, index) => (
            <article className="home-price__card" key={`${group.title}-${index}`}>
              <Link className="home-price__image" href={group.href}>
                {group.image ? <img src={publicPath(group.image)} alt="" loading="lazy" /> : null}
              </Link>
              <div className="home-price__body">
                <h3>{group.title}:</h3>
                <div className="home-price__rows">
                  {group.rows.slice(0, 5).map((row, rowIndex) => {
                    const [label] = (row.name || "").split(":");
                    return (
                      <div className="home-price__row" key={`${row.name}-${rowIndex}`}>
                        <strong>{label}</strong>
                        <span />
                        <b>{row.price}</b>
                      </div>
                    );
                  })}
                </div>
                <div className="home-price__actions">
                  <Link className="home-price__more" href={group.href}>
                    Подробнее
                  </Link>
                  <CallbackButton className="home-price__book">Записаться</CallbackButton>
                </div>
              </div>
            </article>
          ))}
        </div>
        <Link className="home-price__all" href="/price/">
          Прайс-лист
        </Link>
      </div>
    </section>
  );
}
