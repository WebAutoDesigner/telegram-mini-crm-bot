import Link from "next/link";
import { site } from "@/data/site";

export function Footer() {
  return (
    <footer className="footer">
      <div className="shell footer__grid">
        <div>
          <h2>{site.brandName.toUpperCase()}</h2>
          <p>{site.contactBlock.description}</p>
          <div className="socials">
            {site.contactBlock.socials.map((social) => (
              <a key={`${social.label}-${social.href}`} href={social.href} target="_blank" rel="noreferrer" aria-label={social.label || "Социальная сеть"}>
                {social.icon ? <img src={social.icon} alt="" /> : <span>{(social.label || "?").slice(0, 1)}</span>}
              </a>
            ))}
          </div>
        </div>
        <nav className="footer__links" aria-label="Навигация внизу страницы">
          <Link href="/vse-uslugi/">Услуги</Link>
          <Link href="/price/">Прайс-лист</Link>
          <Link href="/contact/">Контакты</Link>
        </nav>
        <div className="footer__contacts">
          <a href={site.contacts.phoneHref}>{site.contacts.phoneDisplay}</a>
          <a href={`mailto:${site.contacts.email}`}>{site.contacts.email}</a>
          <p>{site.contactBlock.address}</p>
          <p>{site.contactBlock.hours}</p>
        </div>
      </div>
    </footer>
  );
}
