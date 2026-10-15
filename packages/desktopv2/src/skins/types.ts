/** PLAN §4 的 skin bundle 规范：tokens 即 L2 语义变量，syntax 是子集别名，assets 可选 */
export type Bundle = {
  id: string;
  name: string;
  mode: "dark" | "light";
  extends?: string;
  tokens: Record<string, string>;
  syntax?: Record<string, string>;
  assets?: Record<string, string>;
};
