import {AsyncLocalStorage} from 'node:async_hooks';
export type RuntimeContext = {
  storage: Map<string,string>;
  simulation?: unknown;
};
const contexts=new AsyncLocalStorage<RuntimeContext>();
export const withContext=<T>(context:RuntimeContext,fn:()=>T):T=>contexts.run(context,fn);
export function currentContext():RuntimeContext {
  const value=contexts.getStore();
  if(!value)throw new Error('Use createRuntime() to establish request-local configuration');
  return value;
}
