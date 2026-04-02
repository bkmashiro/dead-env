const direct = process.env.MY_VAR;
const bracket = process.env['BRACKET_VAR'];
const vite = import.meta.env.VITE_VAR;
const generic = env.GENERIC_VAR;
const alsoUsed = process.env.REAL_VAR; // process.env.IGNORED_COMMENT
const ignoredString = "process.env.IGNORED_STRING";
const ignoredTemplate = `import.meta.env.IGNORED_TEMPLATE`;
/*
process.env.IGNORED_BLOCK
*/

export { direct, bracket, vite, generic, alsoUsed, ignoredString, ignoredTemplate };
