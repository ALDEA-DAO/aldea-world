// Bun text imports: `import sql from "./x.sql" with { type: "text" }`
declare module "*.sql" {
  const content: string;
  export default content;
}
