/**
 * Validate a request body or query against a schema.
 *
 * Returns the parsed value, or null after having sent a 400 with the field-level
 * problems, so a handler reads: `const data = parse(schema, req.body, res); if (!data) return;`
 */
function parse(schema, input, res) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  res.status(400).json({
    error: 'Invalid input',
    details: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
  });
  return null;
}

module.exports = { parse };
