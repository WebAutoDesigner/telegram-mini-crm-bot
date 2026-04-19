function isPlainObject(value) {
  return value !== null && typeof value === "object" && value.constructor === Object;
}

function compactObject(value) {
  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function ensureRows(rows, builderName) {
  if (!Array.isArray(rows)) {
    throw new TypeError(`${builderName} expects an array of button rows.`);
  }

  return rows.map((row) => {
    if (!Array.isArray(row)) {
      throw new TypeError(`${builderName} expects each row to be an array.`);
    }

    return row;
  });
}

export function replyButton(text, options = {}) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new TypeError("replyButton text must be a non-empty string.");
  }

  return compactObject({
    text,
    request_contact: options.request_contact,
    request_location: options.request_location,
    request_poll: options.request_poll,
    web_app: options.web_app,
  });
}

export function inlineButton(text, options = {}) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new TypeError("inlineButton text must be a non-empty string.");
  }

  return compactObject({
    text,
    url: options.url,
    callback_data: options.callback_data,
    web_app: options.web_app,
    login_url: options.login_url,
    switch_inline_query: options.switch_inline_query,
    switch_inline_query_current_chat: options.switch_inline_query_current_chat,
    switch_inline_query_chosen_chat: options.switch_inline_query_chosen_chat,
    copy_text: options.copy_text,
    callback_game: options.callback_game,
    pay: options.pay,
  });
}

function normalizeReplyButton(button) {
  if (typeof button === "string") {
    return replyButton(button);
  }

  if (isPlainObject(button) && typeof button.text === "string") {
    return compactObject(button);
  }

  throw new TypeError("Reply keyboard buttons must be strings or plain objects with text.");
}

function normalizeInlineButton(button) {
  if (typeof button === "string") {
    return inlineButton(button, { callback_data: button });
  }

  if (isPlainObject(button) && typeof button.text === "string") {
    return compactObject(button);
  }

  throw new TypeError("Inline keyboard buttons must be strings or plain objects with text.");
}

export function replyKeyboard(rows, options = {}) {
  return compactObject({
    keyboard: ensureRows(rows, "replyKeyboard").map((row) => row.map(normalizeReplyButton)),
    resize_keyboard: options.resize_keyboard ?? true,
    one_time_keyboard: options.one_time_keyboard,
    selective: options.selective,
    is_persistent: options.is_persistent,
    input_field_placeholder: options.input_field_placeholder,
  });
}

export function inlineKeyboard(rows) {
  return {
    inline_keyboard: ensureRows(rows, "inlineKeyboard").map((row) =>
      row.map(normalizeInlineButton),
    ),
  };
}

export function removeKeyboard(options = {}) {
  return compactObject({
    remove_keyboard: true,
    selective: options.selective,
  });
}

export function forceReply(options = {}) {
  return compactObject({
    force_reply: true,
    selective: options.selective,
    input_field_placeholder: options.input_field_placeholder,
  });
}
