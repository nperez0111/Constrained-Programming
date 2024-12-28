import { createFn } from "./src/db";
import { execute, resolveExecutionContext } from "./src/executer";

// With this, we are creating a function available for use within the program, and storing it into the Database
const adder = await createFn({
  implementation: `
  /**
   * This function adds two numbers
   */
  export default function adder({ x, y }) {
    return x + y;
  }`,
  // By specifying arguments, we can type-check the inputs and outputs of our functions
  arguments: { x: "number", y: "number" },
  outputType: "number",
});

// This module does not have to be statically declared as a dependency of the caller, it can also be imported dynamically, either by name or DefId
const asyncStringify = await createFn({
  implementation: `
  /**
   * This is a function that is resolved dynamically
   */
  export default function stringify(args){
    return JSON.stringify(args)
  }
  `,
  outputType: "string",
});

// This is the main entry point for this program, which will be evaluated and, it's return is the output of the program
const mainFn = await createFn({
  implementation: `
  import adder from '${adder}';

  /**
   * This is the main entrypoint to the program
   */
  export default async function main(){
    const result = adder({ x: 1, y: 2 })
                            // import('stringify') also works too
    const stringify = await import('${asyncStringify}')

    return stringify({ result })
  }
  `,
  outputType: "string",
});

console.log("evaluating the program");
console.log(await execute(await resolveExecutionContext(mainFn)));
