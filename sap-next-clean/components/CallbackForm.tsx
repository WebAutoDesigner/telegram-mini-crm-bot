export function CallbackForm() {
  return (
    <section className="callback" id="callback">
      <div className="callback__card">
        <h2>Обратный звонок</h2>
        <p>Заполните данные ниже и мы вам перезвоним:</p>
        <form>
          <input name="name" placeholder="Имя" />
          <input name="phone" placeholder="+7 (000) 000-00-00" />
          <button type="button">Отправить заявку</button>
        </form>
      </div>
    </section>
  );
}
