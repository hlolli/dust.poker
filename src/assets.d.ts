// Bun's bundler turns image imports into URLs; tell TypeScript the same.
declare module "*.jpg" {
  const url: string;
  export default url;
}
declare module "*.png" {
  const url: string;
  export default url;
}
declare module "*.glb" {
  const url: string;
  export default url;
}
declare module "*.wasm" {
  const url: string;
  export default url;
}
