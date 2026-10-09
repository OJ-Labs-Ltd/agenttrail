import fs from 'node:fs';

export const feedSchema=JSON.parse(fs.readFileSync(new URL('../../schema/feed.schema.json',import.meta.url),'utf8'));

const annotations=['$schema','$id','$defs','title','description','$comment','default','examples'];
const keywords=['type','enum','const','properties','required','additionalProperties','items','maxItems','maxLength','pattern','minimum','maximum','$ref',...annotations];
const typeTests={
  object:v=>v!==null&&typeof v==='object'&&!Array.isArray(v),array:Array.isArray,string:v=>typeof v==='string',
  number:v=>typeof v==='number'&&Number.isFinite(v),integer:Number.isInteger,boolean:v=>typeof v==='boolean',null:v=>v===null
};
const MAX_ERRORS=20;

// ponytail: a subset validator because the package has no runtime dependencies. Keywords outside `keywords`
// (oneOf, allOf, format, remote $ref and the rest) throw rather than being skipped; swap in ajv if the schema outgrows this.
export function validate(schema,value,root,at='$',errors=[]){
  if(errors.length>=MAX_ERRORS)return errors;
  for(const keyword of Object.keys(schema))if(!keywords.includes(keyword))throw new Error(`Unsupported schema keyword: ${keyword}`);
  if(schema.$ref){
    const name=/^#\/\$defs\/([\w-]+)$/.exec(schema.$ref)?.[1],target=name&&root.$defs?.[name];
    if(!target)throw new Error(`Unresolved schema reference: ${schema.$ref}`);
    return validate(target,value,root,at,errors);
  }
  // Messages carry the path and the rule that failed, never the offending value: events can hold secrets.
  const fail=reason=>errors.push(`${at}: ${reason}`);
  if(schema.type){
    const types=[].concat(schema.type);
    if(!types.some(type=>typeTests[type](value)))return fail(`expected ${types.join(' or ')}`),errors;
  }
  if(schema.enum&&!schema.enum.includes(value))fail('not one of the allowed values');
  if('const' in schema&&value!==schema.const)fail('does not match the required constant');
  if(typeof value==='string'){
    if(schema.maxLength!==undefined&&value.length>schema.maxLength)fail(`longer than ${schema.maxLength} characters`);
    if(schema.pattern&&!new RegExp(schema.pattern).test(value))fail('does not match the required pattern');
  }
  if(typeof value==='number'){
    if(schema.minimum!==undefined&&value<schema.minimum)fail(`below the minimum of ${schema.minimum}`);
    if(schema.maximum!==undefined&&value>schema.maximum)fail(`above the maximum of ${schema.maximum}`);
  }
  if(Array.isArray(value)){
    if(schema.maxItems!==undefined&&value.length>schema.maxItems)fail(`more than ${schema.maxItems} items`);
    if(schema.items)value.forEach((item,index)=>validate(schema.items,item,root,`${at}[${index}]`,errors));
  }
  if(typeTests.object(value)){
    // An undefined property is absent on the wire (JSON.stringify drops it), so it counts as missing here too.
    for(const name of schema.required||[])if(value[name]===undefined)errors.push(`${at}.${name}: required`);
    for(const [name,child] of Object.entries(value)){
      if(child===undefined)continue;
      // hasOwn: an inherited lookup would treat `constructor` or `__proto__` as a declared property.
      const rule=schema.properties&&Object.hasOwn(schema.properties,name)?schema.properties[name]:undefined;
      if(rule)validate(rule,child,root,`${at}.${name}`,errors);
      else if(schema.additionalProperties===false)errors.push(`${at}.${name}: unknown property`);
      else if(typeof schema.additionalProperties==='object')validate(schema.additionalProperties,child,root,`${at}.${name}`,errors);
    }
  }
  return errors;
}

export const validateFeed=(definition,value)=>validate({$ref:`#/$defs/${definition}`},value,feedSchema);
