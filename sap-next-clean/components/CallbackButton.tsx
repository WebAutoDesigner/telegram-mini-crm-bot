"use client";

import { useState } from "react";

type Props = {
  children: React.ReactNode;
  className?: string;
};

export function CallbackButton({ children, className = "cta" }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className={className} type="button" onClick={() => setOpen(true)}>
        {children}
      </button>
      {open ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Обратный звонок">
          <button className="modal__backdrop" type="button" aria-label="Закрыть" onClick={() => setOpen(false)} />
          <div className="modal__card">
            <button className="modal__close" type="button" aria-label="Закрыть" onClick={() => setOpen(false)}>
              ×
            </button>
            <h2>Обратный звонок</h2>
            <p>Заполните данные ниже и мы вам перезвоним:</p>
            <form>
              <input name="name" placeholder="Имя" />
              <input name="phone" placeholder="+7 (000) 000-00-00" />
              <button type="button">Отправить заявку</button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
