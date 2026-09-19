import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {assertDDirectory} from './beta-cutover-driver.mjs';
import {compileScenarios,validateScenarios} from './beta-e2e-scenarios.mjs';
const args=process.argv.slice(2);
assert.ok(args.length===6&&args[0]==='--target'&&args[2]==='--date'&&args[4]==='--output');
const file=args[5];assert.ok(path.isAbsolute(file));assertDDirectory(path.dirname(file));
const scenarios=compileScenarios(args[1],args[3]),validation=validateScenarios(scenarios);
fs.writeFileSync(file,JSON.stringify({scenarios,validation},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(validation));
