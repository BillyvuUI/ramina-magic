import {createSparkCommands} from './v2-spark-commands.mjs';
import {createSparkRewardCommands} from './v2-spark-rewards.mjs';
import {ensureSparkFirstLaunch} from './v2-spark-transaction.mjs';
export function createSparkDispatcher(environment,{clock=()=>new Date()}={}){
 const commands={...createSparkCommands(environment,clock),...createSparkRewardCommands(environment,clock)};
 const auth=()=>({uid:environment.auth.currentUser?.uid});
 return {initialize:()=>ensureSparkFirstLaunch(environment,clock),async call(name,data={}){
  if(!commands[name])throw Object.assign(Error('Unknown operation'),{code:'firestore/unimplemented'});
  return commands[name]({auth:auth(),data});
 }};
}
