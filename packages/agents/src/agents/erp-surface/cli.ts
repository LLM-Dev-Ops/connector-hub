#!/usr/bin/env node
/**
 * ERP Surface Agent CLI
 *
 * CLI-invokable endpoint for the ERP Surface Agent.
 *
 * Constitutional Requirements:
 * - Every agent MUST expose a CLI-invokable endpoint
 * - CLI endpoints: ingest / connect / normalize / inspect
 *
 * @example
 * ```bash
 * # Ingest an ERP event
 * erp-surface ingest \
 *   --erp-system sap \
 *   --event-type purchase_order_created \
 *   --payload '{"document_number": "PO-12345"}' \
 *   --tenant-id tenant-123
 *
 * # Inspect agent configuration
 * erp-surface inspect --config
 *
 * # Health check
 * erp-surface health
 * ```
 */

import { Command } from 'commander';
import {
  createERPSurfaceAgent,
  ERPEventInputSchema,
  ERPSystemSchema,
  ERPEventTypeSchema,
  type ERPSurfaceAgentConfig,
} from './index.js';
import { getCurrentTimestamp } from '../../contracts/index.js';

const program = new Command();

program
  .name('erp-surface')
  .description('ERP Surface Agent - Interface with external ERP systems')
  .version('1.0.0');

// ============================================================================
// INGEST Command - Primary CLI endpoint
// ============================================================================

program
  .command('ingest')
  .description('Ingest an ERP event and emit a DecisionEvent')
  .requiredOption('--erp-system <system>', 'ERP system type (sap, oracle_ebs, netsuite, etc.)')
  .requiredOption('--event-type <type>', 'ERP event type (purchase_order_created, invoice_created, etc.)')
  .requiredOption('--payload <json>', 'Event payload as JSON string')
  .requiredOption('--tenant-id <id>', 'Tenant identifier for auth context')
  .option('--event-timestamp <iso>', 'Event timestamp (ISO 8601)', new Date().toISOString())
  .option('--identifiers <json>', 'Business identifiers as JSON', '{}')
  .option('--metadata <json>', 'Additional metadata as JSON', '{}')
  .option('--output <format>', 'Output format (json, pretty)', 'pretty')
  .option('--debug', 'Enable debug output', false)
  .action(async (options) => {
    try {
      // Validate ERP system
      const erpSystemResult = ERPSystemSchema.safeParse(options.erpSystem);
      if (!erpSystemResult.success) {
        console.error(`Invalid ERP system: ${options.erpSystem}`);
        console.error(`Valid systems: ${ERPSystemSchema.options.join(', ')}`);
        process.exit(1);
      }

      // Validate event type
      const eventTypeResult = ERPEventTypeSchema.safeParse(options.eventType);
      if (!eventTypeResult.success) {
        console.error(`Invalid event type: ${options.eventType}`);
        console.error(`Valid types: ${ERPEventTypeSchema.options.join(', ')}`);
        process.exit(1);
      }

      // Parse JSON inputs
      let payload: Record<string, unknown>;
      let identifiers: Record<string, unknown>;
      let metadata: Record<string, unknown>;

      try {
        payload = JSON.parse(options.payload);
      } catch {
        console.error('Invalid payload JSON');
        process.exit(1);
      }

      try {
        identifiers = JSON.parse(options.identifiers);
      } catch {
        console.error('Invalid identifiers JSON');
        process.exit(1);
      }

      try {
        metadata = JSON.parse(options.metadata);
      } catch {
        console.error('Invalid metadata JSON');
        process.exit(1);
      }

      // Build input
      const input = {
        erp_system: erpSystemResult.data,
        event_type: eventTypeResult.data,
        event_timestamp: options.eventTimestamp,
        payload,
        identifiers: Object.keys(identifiers).length > 0 ? identifiers : undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      };

      // Validate full input
      const inputResult = ERPEventInputSchema.safeParse(input);
      if (!inputResult.success) {
        console.error('Input validation failed:');
        console.error(JSON.stringify(inputResult.error.flatten(), null, 2));
        process.exit(1);
      }

      // Create agent and process
      const config: ERPSurfaceAgentConfig = {
        connector_scope: 'erp-connector-cli',
        required_fields: ['event_type', 'event_timestamp', 'payload', 'erp_system'],
        debug: options.debug,
        timeout_ms: 30000,
        max_payload_bytes: 10485760,
        telemetry_enabled: false,
      };

      const agent = createERPSurfaceAgent(config);
      await agent.initialize();

      const response = await agent.process(inputResult.data);

      // Output result
      if (options.output === 'json') {
        console.log(JSON.stringify(response, null, 0));
      } else {
        console.log('\n=== ERP Surface Agent Response ===\n');
        console.log(`Status: ${response.status}`);
        if (response.decision_event) {
          console.log(`Decision Type: ${response.decision_event.decision_type}`);
          console.log(`Execution Ref: ${response.decision_event.execution_ref}`);
          console.log(`Timestamp: ${response.decision_event.timestamp}`);
          console.log(`Confidence: ${response.decision_event.confidence.score}`);
          console.log('\nOutputs:');
          console.log(JSON.stringify(response.decision_event.outputs, null, 2));
        }
        if (response.error) {
          console.log(`\nError: ${response.error.code} - ${response.error.message}`);
        }
        if (response.telemetry) {
          console.log(`\nDuration: ${response.telemetry.duration_ms}ms`);
        }
      }

      process.exit(response.status === 'success' ? 0 : 1);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ============================================================================
// INSPECT Command - View agent configuration
// ============================================================================

program
  .command('inspect')
  .description('Inspect agent configuration and capabilities')
  .option('--config', 'Show configuration', false)
  .option('--systems', 'List supported ERP systems', false)
  .option('--events', 'List supported event types', false)
  .action((options) => {
    if (options.systems) {
      console.log('Supported ERP Systems:');
      ERPSystemSchema.options.forEach((s) => console.log(`  - ${s}`));
      return;
    }

    if (options.events) {
      console.log('Supported Event Types:');
      ERPEventTypeSchema.options.forEach((e) => console.log(`  - ${e}`));
      return;
    }

    if (options.config) {
      console.log('ERP Surface Agent Configuration:');
      console.log(JSON.stringify({
        agent_id: 'erp-surface-agent',
        agent_version: '1.0.0',
        decision_type: 'erp_surface_event',
        supported_erp_systems: ERPSystemSchema.options,
        supported_event_types: ERPEventTypeSchema.options,
        constraints: {
          read_only: true,
          no_workflow_execution: true,
          no_policy_enforcement: true,
        },
      }, null, 2));
      return;
    }

    // Default: show summary
    console.log('ERP Surface Agent v1.0.0');
    console.log('Decision Type: erp_surface_event');
    console.log(`Supported Systems: ${ERPSystemSchema.options.length}`);
    console.log(`Supported Events: ${ERPEventTypeSchema.options.length}`);
    console.log('\nUse --config, --systems, or --events for details');
  });

// ============================================================================
// HEALTH Command - Check agent health
// ============================================================================

program
  .command('health')
  .description('Check agent health status')
  .action(async () => {
    try {
      const config: ERPSurfaceAgentConfig = {
        connector_scope: 'erp-connector-cli',
        required_fields: ['event_type', 'event_timestamp', 'payload', 'erp_system'],
        debug: false,
        timeout_ms: 5000,
        max_payload_bytes: 10485760,
        telemetry_enabled: false,
      };

      const agent = createERPSurfaceAgent(config);
      await agent.initialize();
      const healthy = await agent.healthCheck();

      console.log(JSON.stringify({
        status: healthy ? 'healthy' : 'unhealthy',
        agent_id: 'erp-surface-agent',
        agent_version: '1.0.0',
        timestamp: getCurrentTimestamp(),
      }, null, 2));

      process.exit(healthy ? 0 : 1);
    } catch (error) {
      console.log(JSON.stringify({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: getCurrentTimestamp(),
      }, null, 2));
      process.exit(1);
    }
  });

// ============================================================================
// Parse and execute
// ============================================================================

program.parse();
