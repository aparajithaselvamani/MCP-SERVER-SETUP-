import { attendance, employees, payroll, reviews } from "./mongo-store.mjs";

export async function executePlan(plan) {
  const collection = resolveCollection(plan.collection);
  const mongoStart = Date.now();

  if (plan.operation === "count") {
    const total = await collection.countDocuments(plan.filter ?? {});
    return {
      operation: "count",
      rows: [{ count: total }],
      mongodb_execution_ms: Date.now() - mongoStart
    };
  }

  if (plan.operation === "find") {
    const rows = await collection
      .find(plan.filter ?? {}, { projection: plan.projection ?? { _id: 0 } })
      .sort(plan.sort ?? { name: 1 })
      .limit(plan.limit ?? 25)
      .toArray();
    return {
      operation: "find",
      rows,
      mongodb_execution_ms: Date.now() - mongoStart
    };
  }

  if (plan.operation === "aggregate") {
    const baseFilter = plan.filter ?? {};
    const pipeline = Array.isArray(plan.pipeline) ? plan.pipeline : [];
    const finalPipeline =
      Object.keys(baseFilter).length > 0 ? [{ $match: baseFilter }, ...pipeline] : pipeline;
    const rows = await collection.aggregate(finalPipeline).toArray();
    return {
      operation: "aggregate",
      rows,
      mongodb_execution_ms: Date.now() - mongoStart
    };
  }

  throw new Error("Unsupported operation for executor.");
}

function resolveCollection(name) {
  if (name === "employee_payroll") return payroll();
  if (name === "employee_attendance") return attendance();
  if (name === "employee_reviews") return reviews();
  return employees();
}
