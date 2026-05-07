import { site } from "@/data/site";
import { publicPath } from "@/lib/publicPath";

const nav = [
  { href: "/", label: "Главная" },
  { href: "/vse-uslugi/", label: "Услуги" },
  { href: "/price/", label: "Прайс-лист" },
  { href: "/contact/", label: "Контакты" }
];

export function Header() {
  return (
    <header className="header">
      <div className="shell header__inner">
        <a className="brand" href={publicPath("/")}>
          {site.brandName}
        </a>
        <nav className="nav" aria-label="Основная навигация">
          {nav.map((item) => (
            <a key={item.href} href={publicPath(item.href)}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="header__contacts">
          <a className="header__phone" href={site.contacts.phoneHref}>
            {site.contacts.phoneDisplay}
          </a>
          <div className="socials socials--small">
            {site.contactBlock.socials.map((social) => (
              <a key={`${social.label}-${social.href}`} href={social.href} target="_blank" rel="noreferrer" aria-label={social.label || "Социальная сеть"}>
                {social.icon ? <img src={publicPath(social.icon)} alt="" /> : <span>{(social.label || "?").slice(0, 1)}</span>}
              </a>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
