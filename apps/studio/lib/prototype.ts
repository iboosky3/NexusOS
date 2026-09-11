export interface PrototypeElement {
  kind: "text" | "input" | "button" | "list" | "card";
  label: string;
  detail: string;
  target: string;
}
export interface PrototypePage {
  id: string;
  title: string;
  description: string;
  elements: PrototypeElement[];
  screenshot: string;
}
export interface Prototype {
  input_digest?: string;
  pages: PrototypePage[];
  confirmed: boolean;
}
