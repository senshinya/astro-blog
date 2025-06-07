---
title: Resolving Typename-Variable Name Ambiguity in Syntax Parsing
lang: en
published: 2025-03-15T20:35:00+08:00
tags: ["fiddling", "compilers", "syntax analysis", "ambiguity resolution"]
abbrlink: fiddling/parser-type-variable-ambiguity
description: "In the process of syntax analysis, confusion between user-defined type names and ordinary variable names is a major challenge. For instance, in statements like `a*b;`, the code could be read as either a mathematical expression or a type declaration. This ambiguity stems from grammar design, especially around type specifiers, where a variable identifier might be misinterpreted as a type name, affecting correctness and readability. As uninitialized variable declarations become more common, this issue is increasingly prevalent in source code."
---
### Introduction

During syntax analysis, the parser does not maintain a symbol table, making it difficult to distinguish user-defined type names (`typedef`) from regular variable names. For statements like `a*b;` inside a function body, this could either be an expression multiplying `a` and `b` (with the result ignored), or the declaration of a pointer variable `b` with base type `a`.

This confusion is reflected in grammar rules such as:

```
declaration := declaration_specifiers SEMICOLON
declaration_specifiers := type_specifier declaration_specifiers
type_specifier := INT
type_specifier := typedef_name
typedef_name := IDENTIFIER
```

Rule 1 is often used for struct forward declarations, such as `struct Node;`, which declares a forward reference to a struct type. Owing to this rule, statements like `int a;` might also be parsed this way, where the symbol `a` is interpreted as a user-defined type name rather than a regular variable. Because uninitialized variable definitions are common in code, we end up with a proliferation of possible ASTs (Abstract Syntax Trees) matching the grammar. While this ambiguity can be resolved in semantic analysis via a symbol table, it is feasible to handle much of it earlier, during parsing, at minimal cost, thus reducing the workload for later stages.

### Approach

To resolve the typename-variable name ambiguity, you can use a lightweight symbol table during or after GLR parsing to prune incorrect branches. The table must at least track variable names and user-defined type names, and respect lexical scope, since inner scope symbols can shadow those in outer scopes.

The basic steps are:
1. Maintain a symbol table, gathering type definitions and variable declarations as the parse progresses.
2. When adding a symbol, check for conflicts: does the same symbol already exist as a variable or type in the same scope?
3. For every node reduced by `primary_expression := IDENTIFIER`, check whether the `IDENTIFIER` is an already-declared (and unshadowed) variable.
4. For each node reduced by `typedef_name := IDENTIFIER`, check whether the `IDENTIFIER` is a previously-defined, unshadowed user-defined type.

Take the classic `a*b;` as an example:

```c
// Example 1
typedef int a;
func test_func()
{
	a*b;
}
```

```c
// Example 2
typedef int a;
func test_func()
{
	int a;
	a*b;
}
```

In Example 1, when parsing `a*b;`, scope level 1 (global) contains the user-defined type `a`, and level 2 (function) is empty. If the parser tries to interpret `a*b;` as a declaration (type `a*`, variable `b`), the grammar reduces `a` as a `typedef_name`, and symbol table lookup confirms this is a type — so this AST is retained. When trying to interpret it as an expression (`a` times `b`), the grammar reduces `a` as an identifier, but no variable `a` exists, so this AST is discarded.

In Example 2, when parsing `a*b;`, global scope has a type `a`, and function scope has a variable `a`, which shadows the type. So the declaration branch (reducing `a` as `typedef_name`) fails as `a` is now a variable, and is pruned. But interpreting it as an expression (`a` times `b`) works, as `a` is a variable in the current scope.

Compared to a full-fledged symbol table, this light version does not check for duplicate variables in the same scope (practical for variables, while mismatches for types can still be checked). Because of potential forward declarations and redeclarations being legal, especially for variables without initializers, distinguishing initializations in syntax analysis can be costly — so defer that to semantic analysis. Type checking is also deferred for performance reasons.

Maintaining such a lightweight table during GLR parsing is tricky when it comes to function parameters and variables declared within `for` loops: their scope does not always align with curly braces, making scope management non-trivial. Because GLR parsing constructs the AST from the bottom up, the parser lacks full context for nested scopes during reductions.

It is therefore often simpler to process the AST forest after GLR parsing is complete—traversing each AST to filter out invalid trees. Though this means higher time and space complexity (since branches are not pruned “in flight”), it greatly simplifies implementation. In practice, you can mix in-process pruning and post-process elimination: prune cheaply when possible during parsing, and finish off after parse when necessary, erring on the side of leniency at parse time to avoid discarding a correct AST.

### While Building the AST

When building the AST, you can store and propagate information up the tree as you shift or reduce nodes, making it easier to retrieve when doing top-down semantic processing later. For this ambiguity, my strategy adds two flags to AST nodes:

```go
type GLRLabel struct {
	// Used with Declaration; this is cleared after reducing to Declaration.
	TypeDef      bool     // Is this a typedef?
	DeclaratorID []*Token // Identifiers declared here.
}
```

`TypeDef` marks whether a declaration is a typedef; if, when finally reducing to a declaration, this isn’t set, it’s a variable declaration. `DeclaratorID` holds all symbols declared in this declaration. For function definitions—whose names are handled with identical declarator constructs—`DeclaratorID` also holds the function name.

These flags propagate upwards as the AST is built, for example:

```go
gslice.ForEach(children, func(child *AstNode) {
    if child.TypeDef {
        parent.TypeDef = true
    }
    parent.DeclaratorID = append(parent.DeclaratorID, child.DeclaratorID...)
})
```

When should you set these flags?

- Set `TypeDef` true when reducing `storage_class_specifier := TYPEDEF`.
- Add to `DeclaratorID` on reductions like `direct_declarator := IDENTIFIER`. For enum constants, handle `enumeration_constant := IDENTIFIER` too.

Flags shouldn’t propagate indefinitely up the tree. Once reducing certain nodes, clear them—e.g., after reducing `declaration`, `function_definition`, or (for `direct_declarator`), only propagate `DeclaratorID` from the “innermost” identifier to prevent nested symbols (like function parameters) from leaking outward.

Within AST construction, you can do two certain checks:
1. When user-defined types are used, check that they were previously declared. (This cannot check if a variable has shadowed a type yet.)
2. If `declaration_specifiers` contains a user-defined type as `type_specifier`, it must be the only `type_specifier` present (a typedef type should not combine with others).

For (1), keep a user-type symbol stack, pushing a new scope on `{` and popping one off on `}`. When reducing a typedef declaration, add all its `DeclaratorID`s as type names into the top-of-stack scope. For reductions like `typedef_name := IDENTIFIER`, check from the top down that the `IDENTIFIER` is a defined user type.

For (2), check in reductions to `declaration`, `function_definition`, and `parameter_declaration` that only one (complete) user type is specified.

### After Building the AST

Despite the above, AST construction only resolves type names, not variable names, so some ambiguities remain. For example:

```c
typedef int a;
int main() {
	int a;
	a c;	// Here, variable `a` shadows type `a`, so this declaration is invalid.
}
```

So post-pass, you’ll want a more complete symbol table, tracking both type names and variable names within each scope:

```go
type ScopeSymbols struct {
	TypeNames map[string]*entity.Token
	VarNames  map[string]*entity.Token
}
```

- As before, push a new scope on `{` and pop it on `}`.
- When hitting a `declaration`, add its `DeclaratorID` to type names if `typedef` is set; otherwise to variable names. When adding, check that names aren't duplicated within type/variable sets in a single scope. (Full C actually allows certain redeclarations; for brevity, see semantic analysis for full detail.)
- Function names should also be registered as variables, from the `declarator` in `function_definition`.
- For uses of both type names and variable names: type names only appear in `typedef_name := IDENTIFIER` (already checked before); but after construction, you must also check for type-name shadowing by inner-scope variable names as above. Variable names are checked at `primary_expression := IDENTIFIER` nodes, similarly.

A simple example for checking variable names:

```go
func (s *symbolStack) CheckVar(token *entity.Token, depth int) error {
	for i := depth; i >= 0; i-- {
		if previous, ok := s.stack[i].TypeNames[token.Lexeme]; ok {
			return InvalidSymbolKind(token.SourceStart, previous.SourceStart, token.Lexeme)
		}
		if _, ok := s.stack[i].VarNames[token.Lexeme]; ok {
			return nil
		}
	}
	return UndeclaredIdentifier(token.SourceStart, token.Lexeme)
}
```

Handling functions and for loops requires special attention: their parameters and inside-loop declarations belong to nested inner scopes, not the immediate function/loop scope. Take a for loop body as an example:

```go
currentSymbolStackDepth := s.symbolStack.currentSymbolStackDepth
s.symbolStack.SwitchScope(currentSymbolStackDepth + 1)	// Enter inner scope for decls
for i := 0; i < len(node.Children)-1; i++ {
	if err := s.Chop(node.Children[i]); err != nil {
		return err
	}
}
s.symbolStack.SwitchScope(currentSymbolStackDepth)		// Back to outer after for decls
if err := s.Chop(node.Children[len(node.Children)-1]); err != nil {
	// If the loop body includes `{`, we'd enter that scope naturally
	return err
}
s.symbolStack.EnterScope(currentSymbolStackDepth)		// Force pop if no explicit scope
```