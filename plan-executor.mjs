import { APPROVED_TOOL_NAMES, executeEmployeeTool } from "./employee-tools.mjs";

export async function executeExecutionPlan(plan, { logger = null, question = "" } = {}) {
  const steps = normalizePlan(plan);
  const context = {};
  const results = [];

  log(logger, "Question");
  log(logger, question);
  log(logger, "Execution Plan");
  log(logger, JSON.stringify({ steps }, null, 2));

  for (let index = 0; index < steps.length; index += 1) {
    const stepNumber = index + 1;
    const step = steps[index];
    const rawInput = step.input ?? {};
    const input = resolveVariables(step.input ?? {}, context);

    log(logger, `Step ${stepNumber}`);
    log(logger, "Tool");
    log(logger, step.tool);
    log(logger, "Input");
    log(logger, JSON.stringify(rawInput, null, 2));
    log(logger, "Resolved Input");
    log(logger, JSON.stringify(input, null, 2));

    const result = await executeEmployeeTool(step.tool, input);
    const key = `step${stepNumber}`;
    context[key] = result;
    results.push({ step: stepNumber, tool: step.tool, input: rawInput, resolvedInput: input, result });

    log(logger, "Output");
    log(logger, JSON.stringify(result, null, 2));
  }

  log(logger, "Final Context");
  log(logger, JSON.stringify(context, null, 2));

  return { context, results };
}

export function validateExecutionPlan(plan) {
  try {
    normalizePlan(plan);
    return { ok: true, value: plan };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

function normalizePlan(plan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.steps)) {
    throw new Error("Execution plan must contain a steps array.");
  }

  if (plan.steps.length === 0 || plan.steps.length > 8) {
    throw new Error("Execution plan must contain between 1 and 8 steps.");
  }

  return plan.steps.map((step, index) => {
    if (!step || typeof step !== "object") {
      throw new Error(`Step ${index + 1} must be an object.`);
    }
    if (!APPROVED_TOOL_NAMES.has(step.tool)) {
      throw new Error(`Step ${index + 1} uses an unapproved tool: ${step.tool}`);
    }
    if (step.input !== undefined && (!step.input || typeof step.input !== "object" || Array.isArray(step.input))) {
      throw new Error(`Step ${index + 1} input must be an object.`);
    }
    validateReferences(step.input ?? {}, index + 1);
    return { tool: step.tool, input: step.input ?? {} };
  });
}

function resolveVariables(value, context) {
  if (typeof value === "string") {
    return value.startsWith("$") ? resolveReference(value, context) : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveVariables(item, context));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, resolveVariables(val, context)])
    );
  }

  return value;
}

function resolveReference(reference, context) {
  const path = reference.slice(1).split(".");
  let current = context;

  for (const part of path) {
    if (Array.isArray(current)) {
      current = current[Number(part)];
    } else {
      current = current?.[part];
    }
  }

  if (current === undefined) {
    throw new Error(`Could not resolve variable reference: ${reference}`);
  }

  return current;
}

function validateReferences(value, stepNumber) {
  if (typeof value === "string") {
    if (!value.startsWith("$")) return;
    if (!/^\$step[1-8](?:\.[A-Za-z_][A-Za-z0-9_]*|\.[0-9]+)*$/.test(value)) {
      throw new Error(`Step ${stepNumber} contains invalid variable reference: ${value}`);
    }
    const referencedStep = Number(value.match(/^\$step(\d+)/)?.[1]);
    if (referencedStep >= stepNumber) {
      throw new Error(`Step ${stepNumber} cannot reference ${value}; only earlier steps are available.`);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) validateReferences(item, stepNumber);
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) validateReferences(item, stepNumber);
  }
}

function log(logger, message) {
  if (logger) logger(message);
}
