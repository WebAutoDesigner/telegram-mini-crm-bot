import rawData from "./directus-export.json";

export type PriceRow = {
  name?: string;
  price?: string;
};

export type ServiceImage = {
  image?: string;
  imageMobile?: string;
};

export type ContentBlock = {
  title?: string;
  heading?: string;
  text?: string;
  images?: ServiceImage[];
  priceRows?: PriceRow[];
};

export type Subservice = {
  id?: number;
  title?: string;
  slug?: string;
  heading?: string;
  description?: string;
  images?: ServiceImage[];
  contentBlocks?: ContentBlock[];
  priceRows?: PriceRow[];
};

export type Service = {
  title: string;
  href: string;
  slug: string;
  image?: string;
  imageMobile?: string;
  heroTitle?: string;
  heroImage?: string;
  heroImageMobile?: string;
  description?: string;
  subservices?: Subservice[];
};

type SiteData = {
  brandName?: string;
  contacts?: {
    phoneDisplay?: string;
    phoneHref?: string;
    email?: string;
  };
  contactBlock?: {
    description?: string;
    address?: string;
    hours?: string;
    socials?: Array<{ label?: string; href?: string; icon?: string }>;
  };
  home?: {
    heroTitleHtml?: string;
    heroTitleMobileHtml?: string;
    heroDescription?: string;
    servicesTitle?: string;
    servicesDescription?: string;
  };
  heroImage?: string;
  heroImageMobile?: string;
  services?: Service[];
  works?: Array<{ image?: string; alt?: string }>;
  reviews?: { items?: Array<{ name?: string; text?: string; source?: string }> };
};

const cp1251Extra = "ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—�™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕїАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхчшщъыьэюя";
const cp1251Reverse = new Map(Array.from(cp1251Extra).map((char, index) => [char, index + 128]));

function encodeCp1251(value: string) {
  const bytes: number[] = [];
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 128) bytes.push(code);
    else if (cp1251Reverse.has(char)) bytes.push(cp1251Reverse.get(char)!);
    else return null;
  }
  return Buffer.from(bytes);
}

function mojibakeScore(value: string) {
  return (value.match(/[РС][\u0400-\u04ff]|вЂ|в„|В[ «»]/g) || []).length;
}

function fixMojibake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fixMojibake);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fixMojibake(item)]));
  }
  if (typeof value !== "string" || !mojibakeScore(value)) return value;

  let best = value;
  for (let i = 0; i < 2; i += 1) {
    const encoded = encodeCp1251(best);
    if (!encoded) break;
    const decoded = encoded.toString("utf8");
    if (!decoded || decoded.includes("\uFFFD") || mojibakeScore(decoded) >= mojibakeScore(best)) break;
    best = decoded;
  }
  return best;
}

function withAliases(service: Service): Service {
  if (service.slug === "antidozhd") return { ...service, href: "/anti-rain/" };
  return service;
}

const excludedServiceSlugs = new Set(["antidozhd", "tonirovka"]);

function cleanPlainText(value?: string) {
  return value?.replace(/<br\s*\/?>/gi, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanContentBlock(block: ContentBlock): ContentBlock {
  return {
    ...block,
    title: cleanPlainText(block.title),
    heading: cleanPlainText(block.heading),
    text: cleanPlainText(block.text)
  };
}

function cleanSubservice(subservice: Subservice): Subservice {
  return {
    ...subservice,
    title: cleanPlainText(subservice.title),
    heading: cleanPlainText(subservice.heading),
    description: cleanPlainText(subservice.description),
    contentBlocks: subservice.contentBlocks?.map(cleanContentBlock)
  };
}

function cleanService(service: Service): Service {
  return {
    ...service,
    title: cleanPlainText(service.title) || service.title,
    heroTitle: cleanPlainText(service.heroTitle),
    description: cleanPlainText(service.description),
    subservices: service.subservices?.map(cleanSubservice)
  };
}

const normalized = fixMojibake(rawData) as SiteData;

const featuredWorks = [
  { image: "/assets/img/works/work-01.png", alt: "Интерьер автомобиля со звездным потолком" },
  { image: "/assets/img/works/work-02.png", alt: "Покраска кузова автомобиля в малярной камере" },
  { image: "/assets/img/works/work-03.png", alt: "Черный Rolls-Royce после детейлинга" },
  { image: "/assets/img/works/work-04.jpg", alt: "Шумоизоляция салона автомобиля" },
  { image: "/assets/img/works/work-05.webp", alt: "Мойка красного Lamborghini" }
];

export const site = {
  brandName: normalized.brandName || "AMS detailing",
  contacts: {
    phoneDisplay: normalized.contacts?.phoneDisplay || "+7 (000) 000-00-00",
    phoneHref: normalized.contacts?.phoneHref || "tel:+70000000000",
    email: normalized.contacts?.email || "@mail.ru"
  },
  contactBlock: {
    description: normalized.contactBlock?.description || "Профессиональный уход и защита вашего автомобиля",
    address: normalized.contactBlock?.address || "Самара",
    hours: normalized.contactBlock?.hours || "Пн-Вс: 9:00 - 20:00",
    socials: (normalized.contactBlock?.socials || []).filter((social) => social.href)
  },
  home: {
    heroTitleHtml: normalized.home?.heroTitleHtml || "ДЕТЕЙЛИНГ ЦЕНТР<br>В САМАРЕ",
    heroDescription: normalized.home?.heroDescription || "Профессиональный уход и защита вашего автомобиля",
    servicesTitle: normalized.home?.servicesTitle || "УСЛУГИ:",
    servicesDescription: normalized.home?.servicesDescription || "Предлагаем вам широкий спектр по защите и уходу за вашим автомобилем"
  },
  heroImage: normalized.heroImage || "/assets/img/srv/9209392f-696b-4813-a637-3cee12a9daec.png",
  heroImageMobile: normalized.heroImageMobile || normalized.heroImage || "/assets/img/srv/e72acee3-8f2f-4198-bea2-be75dd826c4f.png",
  services: (normalized.services || [])
    .filter((service) => !excludedServiceSlugs.has(service.slug))
    .map(cleanService)
    .map(withAliases),
  works: [...featuredWorks, ...(normalized.works || []).slice(5)],
  reviews: normalized.reviews?.items || []
};

export function servicePath(service: Service) {
  return service.href.endsWith("/") ? service.href : `${service.href}/`;
}

export function findService(slug: string) {
  return site.services.find((service) => service.href.replace(/^\/|\/$/g, "") === slug || service.slug === slug);
}

export function allPriceGroups() {
  return site.services.flatMap((service) =>
    (service.subservices || []).flatMap((subservice) => {
      const groups: Array<{ service: string; title: string; rows: PriceRow[] }> = [];
      if ((subservice.priceRows || []).some((row) => row.name || row.price)) {
        groups.push({ service: service.title, title: subservice.heading || subservice.title || "Стоимость", rows: subservice.priceRows || [] });
      }
      (subservice.contentBlocks || []).forEach((block) => {
        if ((block.priceRows || []).some((row) => row.name || row.price)) {
          groups.push({ service: service.title, title: block.heading || block.title || "Стоимость", rows: block.priceRows || [] });
        }
      });
      return groups;
    })
  );
}
