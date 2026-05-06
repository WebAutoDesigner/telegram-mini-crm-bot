"use client";

import { useState } from "react";

type Work = {
  image?: string;
  alt?: string;
};

type Props = {
  works: Work[];
};

const INITIAL_COUNT = 5;

export function WorksGallery({ works }: Props) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? works : works.slice(0, INITIAL_COUNT);

  return (
    <section className="works">
      <div className="shell">
        <h2>ГАЛЕРЕЯ РАБОТ:</h2>
        <div className="works__grid">
          {visible.map((work, index) => (
            <button className={`work work--${(index % 5) + 1}`} key={`${work.image}-${index}`} type="button">
              <img src={work.image} alt={work.alt || `Работа ${index + 1}`} loading="lazy" />
            </button>
          ))}
        </div>
        {works.length > INITIAL_COUNT && !expanded ? (
          <button className="works__more" type="button" onClick={() => setExpanded(true)}>
            Смотреть еще
          </button>
        ) : null}
      </div>
    </section>
  );
}
