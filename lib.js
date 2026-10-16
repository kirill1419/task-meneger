export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && value <= '9999-12-31' && dateKey(new Date(value+'T12:00:00')) === value;
}
export function nextDue(task, today = dateKey()) {
  const base = new Date((task.due || today)+'T12:00:00');
  const anchor = task.due ? (task.anchorDay || base.getDate()) : base.getDate();
  let next = new Date(base);
  do {
    if (task.repeat.unit === 'months') {
      next.setDate(1);
      next.setMonth(next.getMonth()+task.repeat.every);
      next.setDate(Math.min(anchor,new Date(next.getFullYear(),next.getMonth()+1,0).getDate()));
    } else next.setDate(next.getDate()+task.repeat.every*(task.repeat.unit === 'weeks' ? 7 : 1));
  } while (dateKey(next) <= today);
  const result = dateKey(next);
  if (!validDate(result)) throw new Error('Следующая дата выходит за допустимый диапазон');
  return result;
}
export function taskInput(input, tags) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 128) throw new Error('Название: от 1 до 128 символов');
  if (typeof input.description !== 'string' || input.description.length > 2048) throw new Error('Описание: максимум 2048 символов');
  const due = input.due || null;
  if (due && !validDate(due)) throw new Error('Некорректная дата');
  if (!Array.isArray(input.tags) || input.tags.some(id=>!tags.some(tag=>tag.id===id))) throw new Error('Выберите существующие теги');
  const repeat = input.repeat;
  if (repeat && (!Number.isInteger(repeat.every) || repeat.every<1 || repeat.every>365 || !['days','weeks','months'].includes(repeat.unit))) throw new Error('Некорректный интервал повторения');
  return {title,description:input.description.trim(),due,tags:[...new Set(input.tags)],repeat:repeat ? {every:repeat.every,unit:repeat.unit} : null};
}
