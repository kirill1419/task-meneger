import {browserApi} from './storage.js';
import {dateKey} from './lib.js';
const $=s=>document.querySelector(s);
let data={tasks:[],tags:[]},view='active',tagFilter=null,editing=null,descending=false;
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dayNumber=key=>Date.parse(key+'T00:00:00Z')/86400000;
function linkifyDescription(value){
  const pattern=/(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  let result='',offset=0;
  for(const match of value.matchAll(pattern)){
    let url=match[0].replace(/[.,!?;:]+$/u,'');
    for(const [open,close] of [['(',')'],['[',']'],['{','}']]){
      while(url.endsWith(close) && url.split(close).length>url.split(open).length)url=url.slice(0,-1);
    }
    result+=escape(value.slice(offset,match.index));
    const href=/^www\./i.test(url)?`https://${url}`:url;
    try{
      const parsed=new URL(href);
      if(!['http:','https:'].includes(parsed.protocol) || !parsed.hostname)throw new Error('Invalid URL');
      result+=`<a class="description-link" href="${escape(parsed.href)}" target="_blank" rel="noopener noreferrer">${escape(url)}</a>`;
    }catch{result+=escape(url);}
    offset=match.index+url.length;
  }
  return result+escape(value.slice(offset));
}
const days=key=>dayNumber(key)-dayNumber(dateKey());
const plural=n=>n%10===1&&n%100!==11?'день':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'дня':'дней';
const shortDate=key=>new Date(key+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'});
const pendingCompletions=new Map();
function taskCard(id){return [...document.querySelectorAll('#tasks .task')].find(card=>card.dataset.id===id);}
function syncCompletions(){
  document.querySelectorAll('#tasks .task').forEach(card=>{
    const pending=pendingCompletions.get(card.dataset.id);
    const task=data.tasks.find(t=>t.id===card.dataset.id);
    if(!task || task.status!=='active')return;
    card.classList.toggle('completion-pending',Boolean(pending));
    const button=card.querySelector('.complete');
    button.textContent=pending?'✓':'';
    button.disabled=Boolean(pending?.saving);
    button.setAttribute('aria-label',pending?'Отменить завершение задачи':`Завершить: ${task.title}`);
    button.title=pending?'Нажмите ещё раз, чтобы отменить завершение':'';
    card.querySelectorAll('.menu-popup button').forEach(item=>item.disabled=Boolean(pending?.saving));
  });
}
function cancelCompletion(id){
  const pending=pendingCompletions.get(id);if(!pending || pending.saving)return;
  clearTimeout(pending.timer);pendingCompletions.delete(id);syncCompletions();
}
function scatterTask(id,kind='complete'){
  const card=taskCard(id);if(!card)return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const rect=card.getBoundingClientRect();
  const dark=document.documentElement.dataset.theme==='dark';
  const color=kind==='complete'?(dark?'#73d6a3':'#35a875'):(dark?'#a9adb5':'#9299a4');
  const direction=kind==='complete'?-1:1;
  const layer=document.createElement('div');layer.className='task-pixels';layer.setAttribute('aria-hidden','true');
  const fragment=document.createDocumentFragment();
  const step=Math.max(5,Math.ceil(Math.sqrt(rect.width*rect.height/1800)));
  for(let y=0;y<rect.height;y+=step){
    for(let x=0;x<rect.width;x+=step){
      const pixel=document.createElement('i');
      pixel.style.cssText=`left:${rect.left+x}px;top:${rect.top+y}px;width:${Math.max(3,step-3)}px;height:${Math.max(3,step-3)}px;background:${color}`;
      fragment.append(pixel);
      pixel.animate([{transform:'translate(0,0) scale(1)',opacity:.95},{transform:`translate(${(Math.random()-.5)*140}px,${direction*(20+Math.random()*100)}px) rotate(${(Math.random()-.5)*120}deg) scale(.15)`,opacity:0}],{duration:1400+Math.random()*600,delay:Math.random()*200,easing:'cubic-bezier(.2,.6,.3,1)',fill:'forwards'});
    }
  }
  layer.append(fragment);document.body.append(layer);setTimeout(()=>layer.remove(),2300);
}
function toggleCompletion(task){
  if(task.status!=='active')return;
  const existing=pendingCompletions.get(task.id);
  if(existing){if(!existing.saving){cancelCompletion(task.id);toast('Завершение отменено');}return;}
  const pending={saving:false,timer:null};
  pendingCompletions.set(task.id,pending);syncCompletions();
  pending.timer=setTimeout(async()=>{
    pending.saving=true;syncCompletions();
    try{
      await api(`/api/tasks/${task.id}`,'PATCH',{status:'completed'},()=>scatterTask(task.id));
      toast(task.repeat?'Задача завершена. Следующее повторение создано':'Задача завершена');
    }catch(error){toast(error.message);}
    finally{pendingCompletions.delete(task.id);syncCompletions();}
  },2000);
}
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4000);}
async function api(url,method,body,beforeRender){const result=await browserApi(url,method,body);if(beforeRender)beforeRender();data=result;render(Boolean(beforeRender));}
function navButton(label,status,icon){const count=data.tasks.filter(t=>t.status===status).length;return `<button class="nav-item ${view===status&&!tagFilter?'active':''}" data-view="${status}"><span class="nav-icon">${icon}</span>${label}<span class="count">${count}</span></button>`;}
function repeatLabel(repeat){if(!repeat)return '';if(repeat.every===1)return {days:'Каждый день',weeks:'Каждую неделю',months:'Каждый месяц'}[repeat.unit];return `Каждые ${repeat.every} ${{days:'дн.',weeks:'нед.',months:'мес.'}[repeat.unit]}`;}
function render(animate=false){
  const today=new Date();
  $('#current-date').dateTime=dateKey(today);
  const dateText=today.toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'});
  const weekday=today.toLocaleDateString('ru-RU',{weekday:'long'});
  $('#current-date').innerHTML=`<span class="current-date-value">${escape(dateText)}</span><span class="current-date-weekday">${escape(weekday.charAt(0).toLocaleUpperCase('ru-RU')+weekday.slice(1))}</span>`;
  const previous=animate?new Map([...document.querySelectorAll('#tasks .task')].map(card=>[card.dataset.id,card.getBoundingClientRect()])):null;
  $('#navigation').innerHTML=navButton('Все задачи','active','▢');
  $('#archive-navigation').innerHTML=navButton('Завершённые','completed','☑')+navButton('Отменённые','cancelled','⊘');
  $('#tag-navigation').innerHTML=data.tags.length?data.tags.map(tag=>`<button class="nav-item ${tagFilter===tag.id?'active':''}" data-tag="${tag.id}"><span class="dot" style="--dot:${tag.color}"></span><span class="tag-name">${escape(tag.name)}</span><span class="count">${data.tasks.filter(t=>t.status==='active'&&t.tags.includes(tag.id)).length}</span></button>`).join(''):'';
  const query=$('#search').value.trim().toLocaleLowerCase('ru');
  let tasks=data.tasks.filter(t=>t.status===view&&(!tagFilter||t.tags.includes(tagFilter))&&(`${t.title} ${t.description} ${t.tags.map(id=>data.tags.find(tag=>tag.id===id)?.name||'').join(' ')}`).toLocaleLowerCase('ru').includes(query));
  tasks.sort((a,b)=>{let order;switch($('#sort').value){case 'new':order=b.createdAt.localeCompare(a.createdAt);break;case 'title':order=a.title.localeCompare(b.title,'ru');break;default:order=(a.due||'9999-99-99').localeCompare(b.due||'9999-99-99');}return descending?-order:order;});
  $('#page-title').textContent=tagFilter?data.tags.find(t=>t.id===tagFilter)?.name:({active:'Все задачи',completed:'Завершённые',cancelled:'Отменённые'}[view]);
  $('#total').textContent=tasks.length;
  $('#tasks').innerHTML=tasks.length?tasks.map(task=>{
    const d=task.due?days(task.due):null;
    const state=task.status!=='active'?'closed':d!==null&&d<3?'urgent':d!==null&&d<7?'soon':'';
    let caption='Осталось',label=d===null?'Без срока':d===0?'Сегодня':d<0?`${Math.abs(d)} ${plural(Math.abs(d))}`:`${d} ${plural(d)}`;
    if(d<0)caption='Просрочено на';if(d===null)caption='';if(d===0)caption='Срок сдачи';
    if(task.status!=='active'){caption='Статус';label=task.status==='completed'?'Завершена':'Отменена';}
    return `<article class="task ${state}" data-id="${task.id}"><button class="complete" data-action="complete" ${task.status!=='active'?'disabled':''} aria-label="Завершить: ${escape(task.title)}">${task.status==='completed'?'✓':task.status==='cancelled'?'−':''}</button><div class="task-content"><h3>${escape(task.title)}</h3>${task.tags.length?`<div class="task-tags">${task.tags.map(id=>{const tag=data.tags.find(t=>t.id===id);return tag?`<span class="tag-pill" style="--tag:${tag.color}">${escape(tag.name)}</span>`:'';}).join('')}</div>`:''}${task.description?`<p class="task-description">${linkifyDescription(task.description)}</p>`:''}</div><div class="deadline"><small>${caption}</small><strong>${label}</strong>${task.due?`<time datetime="${task.due}">до ${shortDate(task.due)}</time>`:''}${task.repeat?`<span class="repeat-badge">↻ &nbsp;${repeatLabel(task.repeat)}</span>`:''}</div><details class="task-menu"><summary aria-label="Действия над задачей">⋮</summary><div class="menu-popup">${task.status==='active'?'<button data-action="edit"><svg class="task-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16 12-12 4 4L8 20H4v-4Z M14 6l4 4"/></svg><span>Изменить</span></button><button data-action="copy"><svg class="task-action-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/></svg><span>Копировать</span></button><button class="danger" data-action="cancel"><svg class="task-action-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="m7 17 10-10"/></svg><span>Отменить задачу</span></button>':`<button data-action="restore">${task.status==='cancelled'?'Восстановить задачу':'Отменить выполнение'}</button><button class="danger" data-action="delete">Удалить</button>`}</div></details></article>`;
  }).join(''):`<div class="empty"><h2>${query?'Ничего не найдено':view==='active'?'Нет активных задач':'Нет задач'}</h2><p>${query?'Попробуйте другое название, описание или тег.':view==='active'?'':''}</p>${view==='active'&&!query?'<button class="primary" id="empty-create">＋ Создать задачу</button>':''}</div>`;
  if(tagFilter && !data.tags.some(tag=>tag.id===tagFilter)){tagFilter=null;render();return;}
  if($('#tags-dialog').open && !tagDrag && !tagOrderSaving)renderManagedTags();
  syncCompletions();
  if(previous && !matchMedia('(prefers-reduced-motion: reduce)').matches){
    document.querySelectorAll('#tasks .task').forEach(card=>{
      const old=previous.get(card.dataset.id), current=card.getBoundingClientRect();
      if(old)card.animate([{transform:`translate(${old.left-current.left}px,${old.top-current.top}px)`},{transform:'translate(0,0)'}],{duration:550,easing:'cubic-bezier(.22,1,.36,1)'});
    });
  }
  renderStats();
}
function renderStats(){
  const completed=data.statistics ?? data.tasks.filter(t=>t.status==='completed'&&t.closedAt);
  const week=Array.from({length:7},(_,i)=>{const date=new Date();date.setDate(date.getDate()-6+i);const key=dateKey(date);return {label:date.toLocaleDateString('ru',{weekday:'short'}),count:completed.filter(t=>dateKey(new Date(t.closedAt))===key).length};});
  const total=week.reduce((sum,d)=>sum+d.count,0),max=Math.max(1,...week.map(d=>d.count));
  const dated=completed.filter(t=>t.due);const onTime=dated.filter(t=>dateKey(new Date(t.closedAt))<=t.due).length;const percent=dated.length?Math.round(onTime/dated.length*100):0;
  const monday=new Date();monday.setHours(12,0,0,0);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);
  const upcomingWeeks=Array.from({length:3},(_,index)=>{
    const start=new Date(monday);start.setDate(start.getDate()+index*7);
    const end=new Date(start);end.setDate(end.getDate()+6);
    const startKey=dateKey(start),endKey=dateKey(end);
    const count=data.tasks.filter(task=>task.status==='active'&&task.due&&task.due>=startKey&&task.due<=endKey).length;
    const format=date=>date.toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
    return {label:['Текущая неделя','Следующая неделя','Через две недели'][index],range:`${format(start)} — ${format(end)}`,count};
  });
  $('#stats').innerHTML=`<section class="stat-card"><h2 class="stat-title">Активность за неделю</h2><p class="stat-caption">Завершённые задачи за последние 7 дней</p><div class="activity-total">${total}<small>сделано за неделю</small></div><div class="chart" role="img" aria-label="${week.map(d=>`${d.label}: ${d.count}`).join(', ')}">${week.map(d=>`<div class="chart-column" title="${d.label}: ${d.count}"><strong class="bar-count">${d.count}</strong><div class="bar" style="height:${Math.max(4,d.count/max*55)}%"></div><span>${d.label}</span></div>`).join('')}</div></section><section class="stat-card"><h2 class="stat-title">Количество задач на неделе</h2><p class="stat-caption">Активные задачи по сроку сдачи · пн–вс</p><div class="weekly-tasks">${upcomingWeeks.map(week=>`<div class="weekly-task-row"><div><span>${week.label}</span><small>${week.range}</small></div><strong>${week.count}</strong></div>`).join('')}</div></section><section class="stat-card"><h2 class="stat-title">Завершено в срок</h2><p class="stat-caption">Задачи с указанной датой сдачи</p><div class="metric-row"><div class="ring" style="--progress:${percent}%" data-label="${dated.length?percent+'%':'—'}"></div><p>${dated.length?`${onTime} из ${dated.length} задач со сроком завершены вовремя`:'Нет завершённых задач со сроком'}</p></div></section>`;
}
function renderTagPicker(selected = []) {
  $('#tag-picker').innerHTML=data.tags.map(tag=>`<label class="tag-option"><input type="checkbox" name="tags" value="${tag.id}" ${selected.includes(tag.id)?'checked':''}><span class="dot" style="--dot:${tag.color}"></span>${escape(tag.name)}</label>`).join('');
}
function openTask(task=null){editing=task?.id||null;const form=$('#task-form');form.reset();$('#task-error').textContent='';$('#form-title').textContent=task?'Редактирование':'Новая задача';form.elements.title.value=task?.title||'';form.elements.description.value=task?.description||'';form.elements.due.value=task?.due||'';form.elements.repeat.value=task?.repeat?(task.repeat.every===1?task.repeat.unit:'custom'):'none';form.elements.every.value=task?.repeat?.every||2;form.elements.unit.value=task?.repeat?.unit||'days';renderTagPicker(task?.tags || (tagFilter ? [tagFilter] : []));updateTaskCounters();syncDurationFromDate();repeatChange();$('#task-dialog').showModal();}
function updateTaskCounters(){
  const fields=$('#task-form').elements;
  for(const name of ['title','description']){
    const input=fields[name],counter=$(`#${name}-count`);
    counter.textContent=`${input.value.length}/${input.maxLength}`;
    counter.classList.toggle('at-limit',input.value.length>=input.maxLength);
    input.setCustomValidity(input.value.length>input.maxLength?`Максимум ${input.maxLength} символов`:'');
  }
}
for(const name of ['title','description']){
  $('#task-form').elements[name].addEventListener('input',updateTaskCounters);
}
function syncDurationFromDate(){
  const fields=$('#task-form').elements;
  fields.durationDays.setCustomValidity('');
  fields.durationDays.value=fields.due.value?days(fields.due.value):'';
}
function syncDateFromDuration(){
  const fields=$('#task-form').elements, input=fields.durationDays;
  input.setCustomValidity('');
  if(input.value==='' && !input.validity.badInput){fields.due.value='';return;}
  const count=input.valueAsNumber;
  const targetDay=dayNumber(dateKey())+count;
  if(!Number.isInteger(count) || targetDay<dayNumber('1900-01-01') || targetDay>dayNumber('9999-12-31')){
    fields.due.value='';input.setCustomValidity('Введите целое число дней с датой от 01.01.1900 до 31.12.9999');return;
  }
  fields.due.value=new Date(targetDay*86400000).toISOString().slice(0,10);
}
$('#task-form').elements.due.addEventListener('input',syncDurationFromDate);
$('#task-form').elements.durationDays.addEventListener('input',syncDateFromDuration);
function repeatChange(){
  const fields=$('#task-form').elements,value=fields.repeat.value;
  fields.every.disabled=value!=='custom';fields.unit.disabled=value!=='custom';
  fields.every.closest('label').hidden=value!=='custom';
  fields.unit.closest('label').hidden=value!=='custom';
  $('#task-form .repeat-fields').classList.toggle('custom-repeat-selected',value==='custom');
  if(value==='none'){fields.every.value='';}
  else if(value!=='custom'){fields.every.value=1;fields.unit.value=value;}
  else if(!fields.every.value){fields.every.value=1;}
}
$('#task-form').elements.repeat.addEventListener('change',repeatChange);
$('#create').onclick=()=>openTask();
let editingTag=null;
const tagIcons={
  edit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-12 12H4v-5Z M13 6l5 5"/></svg>',
  remove:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7"/></svg>'
};
let tagDrag=null, tagOrderSaving=false;
async function saveTagOrder(ids,focusId){
  if(ids.every((id,index)=>data.tags[index]?.id===id)){renderManagedTags();return;}
  tagOrderSaving=true;
  $('#managed-tags').classList.add('order-saving');
  $('#tags-error').textContent='';
  try{await api('/api/tags/reorder','POST',{ids});}
  catch(error){$('#tags-error').textContent=error.message;}
  finally{
    tagOrderSaving=false;
    $('#managed-tags').classList.remove('order-saving');
    renderManagedTags();
    if($('#tags-dialog').open)[...$('#managed-tags').children].find(row=>row.dataset.tagId===focusId)?.querySelector('.tag-drag-handle').focus();
  }
}
const managedTags=$('#managed-tags');
managedTags.addEventListener('pointerdown',event=>{
  const handle=event.target.closest('.tag-drag-handle');
  if(!handle || event.button!==0 || tagOrderSaving)return;
  const row=handle.closest('.managed-tag');
  tagDrag={row,handle,pointerId:event.pointerId,focusId:row.dataset.tagId};
  managedTags.setPointerCapture(event.pointerId);
  row.classList.add('tag-dragging');
  event.preventDefault();
});
managedTags.addEventListener('pointermove',event=>{
  if(!tagDrag || event.pointerId!==tagDrag.pointerId)return;
  const row=tagDrag.row;
  const bounds=$('#tags-dialog').getBoundingClientRect();
  if(event.clientY<bounds.top+70)$('#tags-dialog').scrollTop-=12;
  if(event.clientY>bounds.bottom-70)$('#tags-dialog').scrollTop+=12;
  const siblings=[...managedTags.children].filter(item=>item!==row);
  const next=siblings.find(item=>{const rect=item.getBoundingClientRect();return event.clientY<rect.top+rect.height/2;});
  if(next)managedTags.insertBefore(row,next);else managedTags.append(row);
});
function finishTagDrag(event,cancel=false){
  if(!tagDrag || (event && event.pointerId!==tagDrag.pointerId))return;
  const {row,handle,pointerId,focusId}=tagDrag;
  tagDrag=null;
  if(managedTags.hasPointerCapture(pointerId))managedTags.releasePointerCapture(pointerId);
  row.classList.remove('tag-dragging');
  if(cancel){renderManagedTags();return;}
  const ids=[...managedTags.children].map(item=>item.dataset.tagId);
  void saveTagOrder(ids,focusId);
}
managedTags.addEventListener('pointerup',event=>finishTagDrag(event));
managedTags.addEventListener('pointercancel',event=>finishTagDrag(event,true));
managedTags.addEventListener('lostpointercapture',event=>finishTagDrag(event,true));
$('#tags-dialog').addEventListener('close',()=>finishTagDrag(null,true));
managedTags.addEventListener('keydown',event=>{
  const handle=event.target.closest('.tag-drag-handle');
  if(!handle || !['ArrowUp','ArrowDown'].includes(event.key) || tagOrderSaving || tagDrag)return;
  event.preventDefault();
  const id=handle.closest('.managed-tag').dataset.tagId;
  const ids=data.tags.map(tag=>tag.id),from=ids.indexOf(id),to=from+(event.key==='ArrowUp'?-1:1);
  if(to<0 || to>=ids.length)return;
  [ids[from],ids[to]]=[ids[to],ids[from]];
  void saveTagOrder(ids,id);
});
function renderManagedTags(){
  $('#managed-tags').innerHTML=data.tags.map(tag=>{
    const used=data.tasks.some(task=>task.tags.includes(tag.id));
    const reason=used?'Тег используется в задачах. Сначала уберите его из всех задач.':'Удалить тег';
    return `<div class="managed-tag" data-tag-id="${tag.id}"><button type="button" class="tag-drag-handle" aria-label="Переместить тег ${escape(tag.name)}" title="Перетащите или используйте стрелки вверх и вниз"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16 M4 12h16 M4 18h16"/></svg></button><span class="dot" style="--dot:${tag.color}"></span><span class="managed-tag-name">${escape(tag.name)}</span><button type="button" class="icon-button" data-tag-action="edit" aria-label="Изменить тег ${escape(tag.name)}" title="Изменить тег">${tagIcons.edit}</button><button type="button" class="icon-button tag-delete" data-tag-action="delete" aria-label="Удалить тег ${escape(tag.name)}${used?' — используется в задачах':''}" aria-disabled="${used}" title="${reason}">${tagIcons.remove}</button></div>`;
  }).join('');
}
function openTagEditor(tag=null){
  editingTag=tag?.id||null;
  $('#tag-form').reset();$('#tag-error').textContent='';
  $('#tag-form-title').textContent=tag?'Изменить тег':'Новый тег';
  $('#tag-form').elements.name.value=tag?.name||'';
  $('#tag-form').elements.color.value=tag?.color||'#7d8fea';
  $('#tag-form').querySelector('[type=submit]').textContent=tag?'Сохранить':'Создать тег';
  $('#tag-dialog').showModal();
}
$('#add-tag').onclick=()=>{renderManagedTags();$('#tags-error').textContent='';$('#tags-dialog').showModal();};
$('#task-add-tag').onclick=$('#manager-create-tag').onclick=()=>openTagEditor();
$('#managed-tags').onclick=async event=>{
  const button=event.target.closest('[data-tag-action]');if(!button || tagDrag || tagOrderSaving)return;
  const tag=data.tags.find(tag=>tag.id===button.closest('[data-tag-id]').dataset.tagId);if(!tag)return;
  $('#tags-error').textContent='';
  if(button.dataset.tagAction==='edit'){openTagEditor(tag);return;}
  if(data.tasks.some(task=>task.tags.includes(tag.id))){$('#tags-error').textContent='Нельзя удалить тег: он используется в задачах, включая завершённые и отменённые.';return;}
  button.disabled=true;
  try{await api(`/api/tags/${tag.id}`,'DELETE');toast('Тег удалён');}
  catch(error){$('#tags-error').textContent=error.message;button.disabled=false;}
};
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>button.closest('dialog').close());
$('#navigation').onclick=$('#archive-navigation').onclick=event=>{const button=event.target.closest('[data-view]');if(button){view=button.dataset.view;tagFilter=null;render();}};
$('#tag-navigation').onclick=event=>{const button=event.target.closest('[data-tag]');if(button){tagFilter=button.dataset.tag;view='active';render();}};
$('#search').oninput=()=>render();$('#sort').onchange=()=>render();$('#direction').onclick=()=>{descending=!descending;$('#direction').textContent=descending?'↑↓':'↓↑';render();};
const copyingTasks=new Set();
$('#tasks').onclick=async event=>{
  if(event.target.closest('#empty-create'))return openTask();
  const button=event.target.closest('[data-action]');if(!button)return;
  const task=data.tasks.find(t=>t.id===button.closest('[data-id]').dataset.id);if(!task)return;
  if(button.dataset.action==='complete'){toggleCompletion(task);return;}
  if(button.dataset.action==='copy'){
    if(copyingTasks.has(task.id))return;
    copyingTasks.add(task.id);button.disabled=true;
    try{
      await api('/api/tasks','POST',{title:task.title,description:task.description,due:task.due,tags:[...task.tags],repeat:task.repeat?{...task.repeat}:null});
      toast('Копия задачи создана');
    }catch(error){toast(error.message);}
    finally{copyingTasks.delete(task.id);button.disabled=false;}
    return;
  }
  if(button.dataset.action==='delete'){openTaskDeletion(task);button.closest('details').open=false;return;}
  if(button.dataset.action==='restore'){
    button.disabled=true;
    try{await api(`/api/tasks/${task.id}`,'PATCH',{status:'active'});toast('Задача возвращена в активные');}
    catch(error){toast(error.message);button.disabled=false;}
    return;
  }
  if(pendingCompletions.get(task.id)?.saving)return;
  cancelCompletion(task.id);
  if(button.dataset.action==='edit'){button.closest('details').open=false;return openTask(task);}
  button.closest('details').open=false;
  cancellingTaskId=task.id;
  $('#cancel-task-description').textContent=`Задача «${task.title}» будет перенесена в отменённые.`;
  $('#cancel-task-error').textContent='';
  $('#cancel-task-dialog').showModal();
};
let deletingTaskId=null, deleteTaskBusy=false;
function openTaskDeletion(task){
  if(!['completed','cancelled'].includes(task.status))return;
  deletingTaskId=task.id;
  $('#delete-task-description').textContent=`Задача «${task.title}» будет удалена без возможности восстановления. Статистика сохранится.`;
  $('#delete-task-error').textContent='';
  $('#delete-task-dialog').showModal();
}
$('#delete-task-dialog').addEventListener('cancel',event=>{if(deleteTaskBusy)event.preventDefault();});
$('#delete-task-dialog').addEventListener('close',()=>{deletingTaskId=null;});
$('#confirm-delete-task').onclick=async()=>{
  if(!deletingTaskId || deleteTaskBusy)return;
  const id=deletingTaskId;
  deleteTaskBusy=true;
  $('#delete-task-error').textContent='';
  $('#delete-task-dialog').querySelectorAll('button').forEach(button=>button.disabled=true);
  try{
    await api(`/api/tasks/${id}`,'DELETE',undefined,()=>{
      $('#delete-task-dialog').close();
      scatterTask(id,'remove');
    });
    toast('Задача удалена');
  }catch(error){$('#delete-task-error').textContent=error.message;}
  finally{
    deleteTaskBusy=false;
    $('#delete-task-dialog').querySelectorAll('button').forEach(button=>button.disabled=false);
  }
};
let cancellingTaskId=null, cancelTaskBusy=false;
$('#cancel-task-dialog').addEventListener('cancel',event=>{if(cancelTaskBusy)event.preventDefault();});
$('#cancel-task-dialog').addEventListener('close',()=>{cancellingTaskId=null;});
$('#confirm-cancel-task').onclick=async()=>{
  if(!cancellingTaskId || cancelTaskBusy)return;
  const id=cancellingTaskId;
  cancelTaskBusy=true;
  $('#cancel-task-dialog').querySelectorAll('button').forEach(button=>button.disabled=true);
  $('#cancel-task-error').textContent='';
  try{
    await api(`/api/tasks/${id}`,'PATCH',{status:'cancelled'},()=>{
      $('#cancel-task-dialog').close();
      scatterTask(id,'remove');
    });
    toast('Задача перенесена в отменённые');
  }catch(error){$('#cancel-task-error').textContent=error.message;}
  finally{
    cancelTaskBusy=false;
    $('#cancel-task-dialog').querySelectorAll('button').forEach(button=>button.disabled=false);
  }
};
document.addEventListener('click',event=>document.querySelectorAll('.task-menu[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;}));
$('#task-form').onsubmit=async event=>{event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]'),fields=form.elements;let repeat=null;if(fields.repeat.value!=='none')repeat={every:fields.repeat.value==='custom'?Number(fields.every.value):1,unit:fields.repeat.value==='custom'?fields.unit.value:fields.repeat.value};button.disabled=true;try{await api(editing?`/api/tasks/${editing}`:'/api/tasks',editing?'PATCH':'POST',{title:fields.title.value,description:fields.description.value,due:fields.due.value||null,repeat,tags:[...form.querySelectorAll('[name=tags]:checked')].map(input=>input.value)});$('#task-dialog').close();toast(editing?'Изменения сохранены':'Задача создана');}catch(error){$('#task-error').textContent=error.message;}finally{button.disabled=false;}};
$('#tag-form').onsubmit=async event=>{event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;try{const selected=[...$('#task-form').querySelectorAll('[name=tags]:checked')].map(input=>input.value);
const previousIds=new Set(data.tags.map(tag=>tag.id));
await api(editingTag?`/api/tags/${editingTag}`:'/api/tags',editingTag?'PATCH':'POST',{name:form.elements.name.value,color:form.elements.color.value});
if ($('#task-dialog').open) {
  const created=data.tags.find(tag=>!previousIds.has(tag.id));
  renderTagPicker(created ? [...selected,created.id] : selected);
}
$('#tag-dialog').close();toast(editingTag?'Тег изменён':'Тег создан');}catch(error){$('#tag-error').textContent=error.message;}finally{button.disabled=false;}};
let cleanupAction=null, cleanupTimer=null, cleanupReadyAt=0, cleanupBusy=false;
$('#dark-theme').checked=document.documentElement.dataset.theme==='dark';
$('#dark-theme').onchange=event=>{
  const theme=event.target.checked?'dark':'light';
  document.documentElement.dataset.theme=theme;
  try{localStorage.setItem('tasks-theme',theme);}catch{toast('Тема применена, но браузер не разрешил сохранить выбор');}
};
window.addEventListener('storage',event=>{
  if(event.key==='tasks-theme' || event.key===null){
    const dark=event.key!==null && event.newValue==='dark';
    document.documentElement.dataset.theme=dark?'dark':'light';
    $('#dark-theme').checked=dark;
  }
});
$('#open-settings').onclick=()=>$('#settings-dialog').showModal();
$('#open-about').onclick=()=>$('#about-dialog').showModal();
let importPayload=null,importBusy=false;
$('#export-data').onclick=async()=>{
  try{
    const backup=await browserApi('/api/data','GET');
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`tasks-${dateKey()}.json`;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(error){toast(error.message);}
};
$('#import-data').onclick=()=>{$('#import-file').value='';$('#import-file').click();};
$('#import-file').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    if(file.size>20*1024*1024)throw new Error('Максимальный размер файла — 20 МБ');
    const parsed=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
    if(!parsed || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.tags))throw new Error('Файл должен содержать JSON-базу с задачами и тегами');
    importPayload=parsed;
    $('#import-summary').textContent=`${file.name} · Задач: ${parsed.tasks.length}, тегов: ${parsed.tags.length}`;
    $('#import-error').textContent='';$('#import-dialog').showModal();
  }catch(error){toast(error instanceof SyntaxError?'Не удалось прочитать JSON-файл':error.message);}
};
$('#import-dialog').addEventListener('close',()=>{importPayload=null;});
$('#import-dialog').addEventListener('cancel',event=>{if(importBusy)event.preventDefault();});
$('#confirm-import').onclick=async()=>{
  if(importBusy || !importPayload)return;
  if([...pendingCompletions.values()].some(item=>item.saving) || copyingTasks.size || tagOrderSaving){$('#import-error').textContent='Дождитесь завершения текущего сохранения и повторите импорт';return;}
  importBusy=true;$('#import-error').textContent='';
  $('#import-dialog').querySelectorAll('button').forEach(button=>button.disabled=true);
  for(const id of [...pendingCompletions.keys()])cancelCompletion(id);
  try{
    await api('/api/import','POST',importPayload);
    view='active';tagFilter=null;$('#search').value='';render();
    $('#import-dialog').close();toast('База данных импортирована');
  }catch(error){$('#import-error').textContent=error.message;}
  finally{importBusy=false;$('#import-dialog').querySelectorAll('button').forEach(button=>button.disabled=false);}
};

$('#settings-dialog').addEventListener('click',event=>{
  const button=event.target.closest('[data-cleanup]');
  if(!button || cleanupBusy)return;
  cleanupAction=button.dataset.cleanup;
  $('#cleanup-title').textContent=cleanupAction==='statistics'?'Очистить статистику?':'Удалить закрытые задачи?';
  $('#cleanup-description').textContent=cleanupAction==='statistics'
    ? 'Все статистические показатели будут сброшены. Задачи и теги сохранятся. Отменить очистку нельзя.'
    : 'Все завершённые и отменённые задачи будут удалены без возможности восстановления. Активные задачи, теги и статистика сохранятся.';
  $('#cleanup-error').textContent='';
  clearInterval(cleanupTimer);
  cleanupReadyAt=performance.now()+3000;
  const updateCountdown=()=>{
    const remaining=Math.max(0,Math.ceil((cleanupReadyAt-performance.now())/1000));
    $('#confirm-cleanup').disabled=remaining>0;
    $('#confirm-cleanup').textContent=remaining?`Очистить (${remaining})`:'Очистить';
    if(!remaining)clearInterval(cleanupTimer);
  };
  updateCountdown();
  cleanupTimer=setInterval(updateCountdown,100);
  $('#cleanup-dialog').showModal();
});
$('#cleanup-dialog').addEventListener('close',()=>{clearInterval(cleanupTimer);cleanupAction=null;$('#confirm-cleanup').disabled=true;});
$('#cleanup-dialog').addEventListener('cancel',event=>{if(cleanupBusy)event.preventDefault();});
$('#confirm-cleanup').onclick=async()=>{
  if(cleanupBusy || !cleanupAction || performance.now()<cleanupReadyAt)return;
  const action=cleanupAction;
  cleanupBusy=true;
  $('#cleanup-dialog').querySelectorAll('button').forEach(button=>button.disabled=true);
  $('#confirm-cleanup').textContent='Очистка…';
  try{
    await api(`/api/settings/clear-${action}`,'POST',{});
    $('#cleanup-dialog').close();
    toast(action==='statistics'?'Статистика очищена':'Завершённые и отменённые задачи удалены');
  }catch(error){$('#cleanup-error').textContent=error.message;}
  finally{
    cleanupBusy=false;
    $('#cleanup-dialog').querySelectorAll('button').forEach(button=>button.disabled=false);
    $('#confirm-cleanup').textContent='Очистить';
  }
};
try{await api('/api/data','GET');}catch(error){$('#tasks').innerHTML='<div class="empty"><h2>Хранилище недоступно</h2><p>Разрешите хранение данных для этого сайта в настройках браузера и обновите страницу.</p><button class="primary" onclick="location.reload()">Попробовать снова</button></div>';toast(error.message);}
setInterval(render,60000);
