# Apollo Datasource SWR &bull; [![latest version](https://img.shields.io/npm/v/apollo-datasource-swr/latest.svg)](https://www.npmjs.com/package/apollo-datasource-swr) [![release](https://github.com/andresusanto/apollo-datasource-swr/actions/workflows/release.yml/badge.svg)](https://github.com/andresusanto/apollo-datasource-swr/actions/workflows/release.yml)

[![npm status](https://nodei.co/npm/apollo-datasource-swr.png)](https://www.npmjs.com/package/apollo-datasource-swr)

An implementation of [Apollo Datasource](https://www.apollographql.com/docs/apollo-server/data/data-sources/#open-source-implementations) to support [SWR](https://datatracker.ietf.org/doc/html/rfc5861#section-3) caching mechanism.

Features:

- SWR caching
- Request deduplication

## Installation

```bash
npm i -S apollo-datasource-swr
```

## Usage

Make sure to enable decorator support by adding this line in your `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "experimentalDecorators": true,    // <-- add this
    ...
  },
}
```

```ts
import fetch from "node-fetch";
import { UserInputError } from "apollo-server-express";
import { SWRDataSource } from "apollo-datasource-swr"; // <-- import SWRDataSource

// datasources/movies.ts
class MoviesAPI extends SWRDataSource<Context> {
  private endpoint: string;

  constructor(endpoint: string) {
    super();
    this.endpoint = endpoint;
  }

  @SWRDataSource.useSWR // <-- add this decorator to your fetcher
  async getMovie(movieId: string) {
    const res = await fetch(`${this.endpoint}/movies/${movieId}`);
    const body = await res.json();
    return body as Movie;
  }

  @SWRDataSource.useSWR // <-- add as many methods as you like!
  async getTheatre(theatreId: string) {
    // Apollo request context is available: this.context
    if (!this.context.auth) {
      throw new UserInputError("Not authenticated");
    }

    const res = await fetch(`${this.endpoint}/theatre/${theatreId}`);
    const body = await res.json();
    return body as Theatre;
  }
}

// -------------
// main.ts
// use the data source:
const server = new ApolloServer({
  typeDefs,
  resolvers,
  dataSources: () => {
    return {
      moviesAPI: new MoviesAPI(), // <-- add it in your Apollo Server
    };
  },
});
```
