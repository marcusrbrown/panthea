// Python scripts are imported as text, so a compiled binary carries them.
declare module "*.py" {
  const text: string;
  export default text;
}
