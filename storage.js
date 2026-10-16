import {updateDatabase} from './database.js';

// A database per Pages project; read/write transactions serialize changes across tabs.
const scope=new URL('.',import.meta.url).pathname;
let connection;
function openDatabase(){
  if(connection)return connection;
  connection=new Promise((resolve,reject)=>{
    const request=indexedDB.open(`task-manager-pages:${scope}`,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('database');
    request.onerror=()=>{connection=null;reject(request.error);};
    request.onblocked=()=>{connection=null;reject(new Error('Закройте другие вкладки сайта и повторите попытку'));};
    request.onsuccess=()=>{
      const db=request.result;
      db.onversionchange=()=>{db.close();connection=null;};
      resolve(db);
    };
  });
  return connection;
}

export async function browserApi(path,method='GET',input={}){
  const db=await openDatabase();
  const readOnly=method==='GET' && path==='/api/data';
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('database',readOnly?'readonly':'readwrite');
    const store=transaction.objectStore('database');
    let result,error;
    transaction.oncomplete=()=>resolve(result);
    transaction.onabort=()=>reject(error || transaction.error || new Error('Не удалось сохранить данные в браузере'));
    transaction.onerror=()=>{};
    const request=store.get('state');
    request.onsuccess=()=>{
      try{
        const current=request.result || {tasks:[],tags:[]};
        result=readOnly?current:updateDatabase(current,path,method,input);
        if(!readOnly)store.put(result,'state');
      }catch(cause){error=cause;transaction.abort();}
    };
  });
}
