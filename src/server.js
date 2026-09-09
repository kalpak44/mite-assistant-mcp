import { createServer } from 'node:http'

import { loadConfig } from './config.js'
import { createRequestHandler } from './requestHandler.js'

// Bootstrap only. Everything that decides anything lives in requestHandler.js, which is
// where the tests are — this file runs on import by design, so it cannot hold logic a test
// would need to reach.
const config = loadConfig()
const httpServer = createServer(createRequestHandler(config))

httpServer.listen(config.port, config.host, () => {
  console.log(
    `MCP server listening on http://${config.host}:${config.port}${config.mcpPath}`
  )
})
