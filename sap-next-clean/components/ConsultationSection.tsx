import { site } from "@/data/site";

export function ConsultationSection() {
  return (
    <section className="consultation">
      <div className="shell consultation__card">
        <div>
          <h2>Бесплатная консультация</h2>
          <a className="consultation__phone" href={site.contacts.phoneHref}>
            {site.contacts.phoneDisplay}
          </a>
        </div>
        <div>
          <p className="consultation__text">
            Оставьте заявку, чтобы получить бесплатную консультацию и оценку стоимости работ для вашего автомобиля.
            Менеджер свяжется с вами, поможет подобрать оптимальное решение и подробно ответит на все вопросы.
          </p>
          <form className="consultation__form">
            <input name="name" placeholder="Имя" />
            <input name="phone" placeholder={site.contacts.phoneDisplay} />
            <label>
              <input defaultChecked type="checkbox" />
              <span>Я даю согласие на обработку своих персональных данных</span>
            </label>
            <button type="button">Получить консультацию</button>
          </form>
        </div>
      </div>
    </section>
  );
}
