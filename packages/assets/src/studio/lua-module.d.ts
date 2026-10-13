// Lua scripts are imported as text, so a compiled binary carries them.
declare module "*.lua" {
  const text: string;
  export default text;
}
