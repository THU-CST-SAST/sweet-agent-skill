import {currentContext} from '../runtime/context';
export const storage={
  getItem:async(key:string)=>currentContext().storage.get(key)??null,
  setItem:async(key:string,value:string)=>{currentContext().storage.set(key,value);},
  removeItem:async(key:string)=>{currentContext().storage.delete(key);},
};
