# Example tool calls

Each block shows the `arguments` you pass to a tool.

## oss_search_repositories

```json
{ "query": "vector database", "language": "Rust", "minStars": 500, "sort": "stars", "limit": 10 }
```

## oss_get_repository_profile

```json
{ "repository": "qdrant/qdrant" }
```

## oss_get_repository_tree

```json
{ "repository": "qdrant/qdrant", "recursive": true, "maxFiles": 200 }
```

## oss_read_repository_file

```json
{ "repository": "qdrant/qdrant", "path": "README.md", "maxChars": 20000 }
```

## oss_get_readme

```json
{ "repository": "qdrant/qdrant" }
```

## oss_check_license

```json
{ "repository": "qdrant/qdrant" }
```

## oss_analyze_repository

```json
{
  "repository": "qdrant/qdrant",
  "includeReadme": true,
  "includeTree": true,
  "includeLicense": true,
  "includePackageFiles": true
}
```

## oss_compare_repositories

```json
{
  "repositories": ["qdrant/qdrant", "milvus-io/milvus", "weaviate/weaviate"],
  "criteria": {
    "preferActiveMaintenance": true,
    "preferPermissiveLicense": true,
    "preferEasyIntegration": true
  }
}
```

## oss_find_open_source_alternatives

```json
{
  "target": "Algolia",
  "useCase": "full-text search for a docs site",
  "language": "TypeScript",
  "mustBeFree": true,
  "mustBeSelfHosted": true,
  "licensePreference": "avoid-strong-copyleft",
  "limit": 5
}
```

## oss_generate_integration_notes

```json
{
  "repository": "meilisearch/meilisearch",
  "targetStack": "Node.js + Next.js",
  "useCase": "site search"
}
```

## oss_deepwiki_summary

```json
{ "repository": "facebook/react", "question": "How does reconciliation work?" }
```

> DeepWiki is disabled by default. Set `OSS_MCP_DEEPWIKI_ENABLED=true` to enable
> external calls to `mcp.deepwiki.com`.

## oss_health_check

```json
{}
```
