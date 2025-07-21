# SpeedGoose Project Overview

## Project Goal
Provide a high-performance dual-layer caching solution for Mongoose (MongoDB ODM) that:
- Offers Redis-based shared caching and in-memory local caching
- Maintains data consistency through automatic cache invalidation
- Supports complex Mongoose operations including lean queries and aggregations
- Enables multi-tenant architectures with isolated cache management

## Key Selling Points
- **Hybrid Caching Architecture**: Combines Redis for distributed caching with in-memory caching for reduced latency
- **Context-Aware Auto Invalidation**: Automatic cache clearance based on Mongoose model events
- **Deep Hydration**: Preserves Mongoose document instances with populated references
- **Multi-Tenancy Support**: Tenant-specific cache isolation using configurable key strategies
- **Operational Flexibility**:
  - Custom TTL per query/pipeline
  - Debugging tools with granular control
  - Multiple cache storage strategies (Redis/In-Memory)

## Target Audience
- Node.js developers building high-throughput MongoDB applications
- Teams requiring optimized database performance without complex caching implementations
- Projects needing transparent cache synchronization across distributed systems
- Applications with multi-tenant architectures requiring isolated data caching

## Linked Specifications
1. [ARCHITECTURE_DECISIONS.md](spec/01_ARCHITECTURE_DECISIONS.md) (Pending)
2. [CACHING_STRATEGIES.md](spec/02_CACHING_STRATEGIES.md) (Pending) 
3. [MULTITENANCY_IMPLEMENTATION.md](spec/03_MULTITENANCY_IMPLEMENTATION.md) (Pending)
4. [PERFORMANCE_METRICS.md](spec/04_PERFORMANCE_METRICS.md) (Pending)