# Contributing

We welcome contributions from startup CTOs, platform engineers, and anyone who's deployed Azure infrastructure at scale and learned from it.

## What We're Looking For

- **Real-world configurations** — Have you deployed a landing zone for your startup? Share what worked and what didn't.
- **New examples** — Startup archetypes we haven't covered (fintech, healthtech, gaming, e-commerce).
- **Bug fixes** — Bicep/Terraform that doesn't compile or deploy correctly.
- **Documentation improvements** — Clearer explanations, better diagrams, updated pricing.
- **Policy definitions** — Custom Azure Policies that solve real startup problems.

## How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-contribution`)
3. Make your changes
4. Test your IaC changes deploy successfully (if applicable)
5. Submit a pull request with a clear description of what you changed and why

## Guidelines

- **Keep it simple.** This project exists because the enterprise alternatives are too complex. Don't add complexity.
- **Be opinionated.** "It depends" isn't helpful. Make a recommendation and explain when it doesn't apply.
- **No marketing language.** Write for engineers. Skip the adjectives.
- **Test your code.** If you submit Bicep or Terraform, it should deploy without errors.
- **Include costs.** If you recommend a service, include the approximate monthly cost.

## Code Style

- **Bicep:** Follow [Bicep best practices](https://learn.microsoft.com/azure/azure-resource-manager/bicep/best-practices). Use descriptive resource names, add `@description` decorators on parameters.
- **Terraform:** Follow [Terraform style conventions](https://developer.hashicorp.com/terraform/language/syntax/style). Use `terraform fmt`.
- **Markdown:** Keep lines under 120 characters. Use tables for comparisons. Use code blocks for commands.

## Reporting Issues

Use GitHub Issues for:
- Bugs in IaC code
- Incorrect or outdated information
- Feature requests for new examples or modules

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
