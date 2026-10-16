import {taskInput,nextDue,dateKey} from './lib.js';
import {validateBackup} from './backup.js';
const randomUUID=()=>crypto.randomUUID();
export function updateDatabase(database,pathname,method,input={}){
  const copy=structuredClone(database);
  const url={pathname};
  const req={method};
        if(url.pathname==='/api/import' && req.method==='POST'){
          const imported=validateBackup(input);
          for(const key of Object.keys(copy))delete copy[key];
          Object.assign(copy,imported);
          return copy;
        }
        // Keep statistics independent of archived task cards; migrate older databases lazily.
        copy.statistics ??= copy.tasks.filter(t=>t.status==='completed'&&t.closedAt).map(t=>({taskId:t.id,createdAt:t.createdAt,closedAt:t.closedAt,due:t.due}));
        if(url.pathname==='/api/settings/clear-statistics' && req.method==='POST') {
          copy.statistics=[];
          copy.statisticsResetAt=new Date().toISOString();
        } else if(url.pathname==='/api/settings/clear-archive' && req.method==='POST') {
          copy.tasks=copy.tasks.filter(t=>!['completed','cancelled'].includes(t.status));
        } else if(url.pathname==='/api/tags/reorder' && req.method==='POST') {
          const ids=input.ids;
          if(!Array.isArray(ids) || ids.length!==copy.tags.length || new Set(ids).size!==ids.length || ids.some(id=>!copy.tags.some(tag=>tag.id===id))) throw new Error('Список тегов изменился. Обновите страницу и повторите сортировку');
          copy.tags=ids.map(id=>copy.tags.find(tag=>tag.id===id));
        } else if(/^\/api\/tags\/[^/]+$/.test(url.pathname) && req.method==='DELETE') {
          const id=url.pathname.split('/').pop();
          if(!copy.tags.some(t=>t.id===id)) throw new Error('Тег не найден');
          if(copy.tasks.some(t=>t.tags.includes(id))) throw new Error('Нельзя удалить тег: он используется в задачах, включая завершённые и отменённые');
          copy.tags=copy.tags.filter(t=>t.id!==id);
        } else if((url.pathname==='/api/tags' && req.method==='POST') || (/^\/api\/tags\/[^/]+$/.test(url.pathname) && req.method==='PATCH')) {
          const existing=req.method==='PATCH'?copy.tags.find(t=>t.id===url.pathname.split('/').pop()):null;
          if(req.method==='PATCH' && !existing) throw new Error('Тег не найден');
          const name=typeof input.name==='string'?input.name.trim().replace(/\s+/g,' '):'';
          if(!name || name.length>40) throw new Error('Тег: от 1 до 40 символов');
          if(copy.tags.some(t=>t.id!==existing?.id && t.name.normalize('NFKC').toLocaleLowerCase('ru')===name.normalize('NFKC').toLocaleLowerCase('ru'))) throw new Error('Такой тег уже существует');
          if(!/^#[0-9a-f]{6}$/i.test(input.color)) throw new Error('Некорректный цвет');
          if(existing) Object.assign(existing,{name,color:input.color});
          else copy.tags.push({id:randomUUID(),name,color:input.color});
        } else if(url.pathname==='/api/tasks' && req.method==='POST') {
          const fields=taskInput(input,copy.tags);
          copy.tasks.push({...fields,id:randomUUID(),status:'active',createdAt:new Date().toISOString(),closedAt:null,anchorDay:new Date((fields.due||dateKey())+'T12:00:00').getDate()});
        } else if(/^\/api\/tasks\/[^/]+$/.test(url.pathname) && req.method==='DELETE') {
          const id=url.pathname.split('/').pop();
          const task=copy.tasks.find(t=>t.id===id);
          if(!task) throw new Error('Задача не найдена');
          if(!['completed','cancelled'].includes(task.status)) throw new Error('Можно удалить только завершённую или отменённую задачу');
          copy.tasks=copy.tasks.filter(t=>t.id!==id);
        } else if(/^\/api\/tasks\/[^/]+$/.test(url.pathname) && req.method==='PATCH') {
          const task=copy.tasks.find(t=>t.id===url.pathname.split('/').pop());
          if(!task) throw new Error('Задача не найдена');
          if(input.status) {
            if(input.status==='active') {
              if(!['completed','cancelled'].includes(task.status)) throw new Error('Задача уже активна');
              if(task.status==='completed') {
                const index=copy.statistics.findIndex(record=>record.taskId===task.id || (!record.taskId && record.createdAt===task.createdAt && record.closedAt===task.closedAt));
                if(index!==-1) copy.statistics.splice(index,1);
              }
              task.status='active';task.closedAt=null;
              return copy;
            }
            if(!['completed','cancelled'].includes(input.status)) throw new Error('Недопустимый статус');
            if(task.status!=='active') throw new Error('Задача уже закрыта');
            task.status=input.status; task.closedAt=new Date().toISOString();
            if(task.status==='completed') copy.statistics.push({taskId:task.id,createdAt:task.createdAt,closedAt:task.closedAt,due:task.due});
            if(task.status==='completed' && task.repeat) copy.tasks.push({...task,id:randomUUID(),due:nextDue(task),anchorDay:task.due?task.anchorDay:new Date().getDate(),status:'active',createdAt:new Date().toISOString(),closedAt:null});
          } else {
            const fields=taskInput(input,copy.tags);
            if(fields.due!==task.due) task.anchorDay=new Date((fields.due||dateKey())+'T12:00:00').getDate();
            Object.assign(task,fields);
          }
        } else throw new Error('Маршрут не найден');
        return copy;

}
