import {taskInput,validDate} from './lib.js';

export function validateBackup(value){
  const fail=()=>{throw new Error('Некорректная база данных: проверьте задачи, теги и статистику');};
  const object=v=>v && typeof v==='object' && !Array.isArray(v);
  const id=v=>typeof v==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
  const timestamp=v=>typeof v==='string' && Number.isFinite(Date.parse(v));
  if(!object(value) || !Array.isArray(value.tasks) || !Array.isArray(value.tags))fail();
  const names=new Set(),tagIds=new Set(),taskIds=new Set();
  for(const tag of value.tags){
    if(!object(tag) || !id(tag.id) || tagIds.has(tag.id) || typeof tag.name!=='string' || !tag.name.trim() || tag.name.length>40 || !/^#[0-9a-f]{6}$/i.test(tag.color))fail();
    const name=tag.name.trim().replace(/\s+/g,' ').normalize('NFKC').toLocaleLowerCase('ru');
    if(names.has(name))fail();names.add(name);tagIds.add(tag.id);
  }
  for(const task of value.tasks){
    if(!object(task) || !id(task.id) || taskIds.has(task.id) || !['active','completed','cancelled'].includes(task.status) || !timestamp(task.createdAt))fail();
    if(task.status==='active' ? task.closedAt!==null : !timestamp(task.closedAt))fail();
    // Preserve descriptions and titles from older releases with larger limits.
    if(typeof task.title!=='string' || task.title.length>160 || typeof task.description!=='string' || task.description.length>10000)fail();
    taskInput({...task,title:task.title.slice(0,128),description:task.description.slice(0,2048)},value.tags);
    if(task.anchorDay!==undefined && (!Number.isInteger(task.anchorDay) || task.anchorDay<1 || task.anchorDay>31))fail();
    taskIds.add(task.id);
  }
  if(value.statistics!==undefined){
    if(!Array.isArray(value.statistics))fail();
    for(const record of value.statistics){
      if(!object(record) || !timestamp(record.createdAt) || !timestamp(record.closedAt) || (record.due!==null && !validDate(record.due)) || (record.taskId!==undefined && !id(record.taskId)))fail();
    }
  }
  if(value.statisticsResetAt!==undefined && !timestamp(value.statisticsResetAt))fail();
  const result={tasks:structuredClone(value.tasks),tags:structuredClone(value.tags)};
  if(value.statistics!==undefined)result.statistics=structuredClone(value.statistics);
  if(value.statisticsResetAt!==undefined)result.statisticsResetAt=value.statisticsResetAt;
  return result;
}
