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

```ts
import fetch from "node-fetch";
import { SWRDataSource } from "apollo-datasource-swr";

// datasources/movies.ts
type MovieArg = [movieId: string];
class MoviesAPI extends SWRDataSource<MovieArg, Movie, Context> {
  private endpoint: string;

  constructor(endpoint: string) {
    super();
    this.endpoint = endpoint;
  }

  protected async onRevalidate(ctx: Context, movieId: string): Promise<Movie> {
    const res = await fetch(`${this.endpoint}/movies/${movieId}`);
    const body = await res.json();
    return body as Movie;
  }

  async getMovie(movieId: string) {
    return this.get(movieId);
  }
}

// main.ts
// use the data source:
const server = new ApolloServer({
  typeDefs,
  resolvers,
  dataSources: () => {
    return {
      moviesAPI: new MoviesAPI(),
    };
  },
});
```
