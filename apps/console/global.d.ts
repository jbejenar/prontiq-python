declare module "*.css";

declare module "@httptoolkit/httpsnippet" {
  interface HTTPSnippetOptions {
    indent?: string;
  }

  interface HTTPSnippetInstance {
    convert(target: string, client?: string, options?: HTTPSnippetOptions): false | string;
  }

  const HTTPSnippet: new (source: unknown) => HTTPSnippetInstance;
  export = HTTPSnippet;
}
