---
title: 语法分析中类型名-变量名歧义消除
published: 2025-03-15T20:35:00+08:00
tags: ["折腾","编译原理","语法分析","歧义消除"]
description: "在语法分析过程中，用户自定义类型名与普通变量名的混淆成为一大难题。特别是在某些情况下，如 `a*b;`，该语句既可能被解读为数学表达式，也可能被视为类型声明。这种模糊性源于语法规则的设计，特别是涉及类型说明符的部分，可能会导致变量名被误认作类型名，影响代码的正确性与可读性。随着无初始化变量定义的普遍存在，这一问题在源码中愈发明显。"
---
### 引

由于语法分析阶段不维护符号表，用户自定义类型名（typedef）和普通变量名难以区分。对于函数体中的 `a*b;`​ 语句，既可以解释为 a 乘 b，忽略表达式结果，也可以解释为声明一个类型为 `a*`​ 的变量 b

同时，由于存在如下语法规则

```
declaration := declaration_specifiers SEMICOLON
declaration_specifiers := type_specifier declaration_specifiers
type_specifier := INT
type_specifier := typedef_name
typedef_name := IDENTIFIER
```

规则 1 多用于无需指定标识符的结构体前向声明。如 `struct Node;`​ 表示前向声明一个 `struct Node`​ 类型。由于该规则的存在，譬如 `int a;`​ 也可能会使用规则 1 规约，符号 a 会被识别为一个用户自定义类型名而非变量名。由于类似的无初始化变量的定义语句容易在源码中大量出现，会导致一份源码会对应较多满足语法规则的 AST。这个问题可以在语义分析阶段通过维护符号表解决，但是在语法分析阶段也可以以较小的代价提前处理，减少语义分析需要处理的 AST 个数

### 思路

对于这种类型名 - 变量名的歧义，可以在 GLR 的执行过程中或执行后通过维护代价较小的简易符号表的方式对错误的分支进行剪枝。这个符号表至少要维护变量名和用户自定义类型名，同时由于存在深层作用域变量/类型名对浅层作用域符号的遮蔽，这个符号表还需要跟踪符号的作用域

那么需要做的事情就很简单了：

1. 维护符号表，收集类型定义和变量声明
2. 添加符号时校验同级作用域是否有同名变量声明和类型定义
3. 对所有使用 `primary_expression := IDENTIFIER`​ 规约的节点检查 `IDENTIFIER`​ 是否是一个已经定义且未被遮蔽的变量名
4. 对所有使用 `typedef_name := IDENTIFIER`​ 规约的节点检查 `IDENTIFIER`​ 是否是一个已经定义过且未被遮蔽的用户自定义类型名

以经典 `a*b;`​ 为例：

```c
// 例 1
typedef int a;
func test_func()
{
	a*b;
}
```

```c
// 例 2
typedef int a;
func test_func()
{
	int a;
	a*b;
}
```

例 1：解析到 `a*b;`​ 时，符号表的 1 级作用域（最外层）中有一个自定义类型 a，2 级作用域（函数）中无符号。对于将 `a*b;`​ 解析为声明一个类型为 `a*`​ 的变量 `b`​ 的 AST，a 会使用 `typedef_name := IDENTIFIER`​ 进行规约，检查符号表发现 a 确实是一个声明在 1 级作用域的自定义类型名，于是该 AST 会被保留；对于将其解析为变量 `a`​ 乘以变量 `b`​ 的 AST，a 会使用 `primary_expression := IDENTIFIER`​ 进行规约，检查符号表发现表中并没有变量 a，于是该 AST 会被抛弃

例 2：解析到 `a*b;`​ 时，符号表的 1 级作用域（最外层）中有一个自定义类型 a，，2 级作用域（函数）中有一个变量 a，此时变量 a 会遮蔽自定义类型 a。对于将 `a*b;`​ 解析为声明一个类型为 `a*`​ 的变量 `b`​ 的 AST，a 会使用 `typedef_name := IDENTIFIER`​ 进行规约，检查符号表发现在该作用域下 a 是一个变量而非自定义类型（遮蔽），于是该 AST 会被抛弃；对于将其解析为变量 `a`​ 乘以变量 `b`​ 的 AST，a 会使用 `primary_expression := IDENTIFIER`​ 进行规约，检查符号表发现 a 确实是一个变量名，于是该 AST 会被保留

相对于完整的符号表，简易符号表不会检查作用域内同类变量的同名问题（可以检查用户自定义类型名的同名），由于存在前向声明，对相同变量的多次声明是合法的，而包含初始化的声明只可以有一次，在语法分析阶段区分声明是否包含初始化成本还是比较高的，建议延后到语义分析阶段；同时由于成本问题类型检查也不会在这个阶段进行

在 GLR 执行过程维护简易符号表，难以处理函数参数和 for 循环中的变量声明，这些变量的作用域实际在更深层，且作用域的开始和结束并不完全和大括号的范围重合，由于对于函数定义的规约，一定是首先移入左右大括号，之后才能规约为函数定义，这就导致没法简单地在移入左右大括号时处理作用域，只有综合看当前符号栈中的多个符号才能判断。究其原因，是因为 GLR 构建 AST 是自底向下构建的——从叶子节点一步步构建出根节点，底层节点会被优先处理，从而缺乏对节点上下文的感知

在 GLR 执行完成后通过遍历 AST 森林对单棵 AST 进行检查排除的方法就相对简单了很多，尽管无法在执行中剪枝，导致了相对较高的时间和空间复杂度，但是其优点在于实现简单、实现简单和实现简单。在实际实现过程中，可以综合使用执行中剪枝和执行后排除：执行中剪枝代价较小，且一旦剪枝成功，就能够减少执行后排除需要处理的 AST 数量。由于执行后排除一定可以解决该歧义，执行中剪枝需要保证“宁可放过不可错杀”

### AST 构建中

AST 构建中可以在移入一些符号或发生规约时，在节点中存储一些信息并向上传递，方便后续再自顶向下处理时可以快速获取信息，对于处理这个歧义，我的处理是增加两个标记

```go
type GLRLabel struct {
	// Declaration 使用，规约出 Declaration 后消除
	TypeDef      bool     // 是否是 TypeDef
	DeclaratorID []*Token // 包含的 Identifier
}
```

typedef 用于标识这个声明是否是一个类型定义，如果最终规约出 declaration 时没有这个标识，说明这个声明只是一个普通的变量声明。DeclaratorID 为这个 declaration 定义的符号，如果这个声明是一个类型定义，那么 DeclaratorID 中为自定义类型的名称。同样，由于 function_definition 中的函数名称也使用了和 declaration 类似的 declarator 处理（`function_definition := declaration_specifiers declarator compound_statement`​），所以 DeclaratorID 中也会包含函数名称

这两个符号在构建 AST 树时，从下层向上层节点传递

```go
gslice.ForEach(children, func(child *AstNode) {
    if child.TypeDef {
        parent.TypeDef = true
    }
    parent.DeclaratorID = append(parent.DeclaratorID, child.DeclaratorID...)
})
```

那么在哪些场景设置这两个符号呢？

typedef 很明显，当使用 `storage_class_specifier := TYPEDEF`​进行规约时设置当前节点的 `typedef`​ 为 true

DeclaratorID 就比较复杂了，比较基础的如 `direct_declarator := IDENTIFIER`​。另外，考虑枚举常量的场景，还需要处理 `enumeration_constant := IDENTIFIER`​

当然，不能允许这两个符号无限向上传播，构建后自顶向下处理某一节点时应当只期望处理该级节点的信息，而非混杂着下层节点的信息（由于 C 语言中作用域的限制，信息只能从上级向下级传递，下级信息无法影响上级）。这时就需要在规约出某些节点时清空标记，阻断标记的向上传播

阻断向上传播的时机，除了规约出 `declaration`​ 和 `function_definition`​ 外，规约出 `direct_declarator`​时，对于通过形如 `direct_declarator := direct_declarator LEFT_PARENTHESES parameter_type_list RIGHT_PARENTHESES`​ 规约出的节点，应当只取右侧 `direct_declarator`​中的 DeclaratorID 继续传播，以避免 `parameter_type_list`​ 包含函数参数声明的影响

在 AST 构建中，可以进行的、确定无误的检查，有以下两个：

1. 使用用户自定义类型时，检查是否是先前声明过的类型（无法检查变量声明遮蔽）
2. ​`declaration_specifiers`​中如果包含自定义类型的 `type_specifier`​，那么只可以包含这一个 `type_specifier`​（自定义类型已是完整类型，不应和其他类型符号一起使用）

第一个检查在构建时维护一个自定义类型符号栈，在移入 `{`​ 时压入新作用域，在移入 `}`​ 时弹出顶栈作用域。在规约出 Declaration 时，检查节点的 typedef 符号，如果是一个 typedef，就将这个节点的所有 DeclaratorID 加入顶栈作用域。在遇到通过 `typedef_name := IDENTIFIER`​ 规约的节点时，说明这个 `IDENTIFIER`​ 是一个此前定义的自定义类型，从栈顶开始向栈底检查即可

第二个检查比较简单，在规约出 `declaration`​、`function_definition`​ 和 `parameter_declaration`​ 时，检查 `declaration_specifiers`​ 即可

### AST 构建后

在通过上述方式完成构建后，由于构建中的检查只处理了自定义类型，没有处理变量名，所以依然会有一些错误和歧义无法解决，如

```c
typedef int a;
int main() {
	int a;
	a c;	// 类型 a 已经被变量 a 遮蔽，此处声明不合法
}
```

所以在构建后需要维护一个相对更全面一些的符号表，在每个作用域中同时记录类型名和变量名

```go
type ScopeSymbols struct {
	TypeNames map[string]*entity.Token
	VarNames  map[string]*entity.Token
}
```

和构建中检查类似，在移入 `{`​ 时压入新作用域，在移入 `}`​ 时弹出栈顶作用域，遇到 `declaration`​ 节点，如果包含 typedef 符号，则将 DeclaratorID 加入栈顶作用域的类型名处，否则加入栈顶作用域的变量名中。在加入变量名时，需要检查栈顶作用域是否包含同名的类型名，若包含则需要返回错误；反之加入类型名时亦然

除此以外，函数定义中的函数名也需要作为变量符号加入符号表，函数变量的定义都形如`function_definition := declaration_specifiers declarator...`​，`declarator`​ 中的 DeclaratorID 即为函数名

接着就是检查自定义类型名和变量名的使用点了。自定义类型仅在 `typedef_name := IDENTIFIER`​ 处使用，在 AST 构建中已经检查过这个自定义类型是否已经定义过。在构建后检查中，需要额外检查这个类型名是否被变量名遮蔽，如果在更深层作用域中被遮蔽时仍然需要返回错误。变量名则是在 `primary_expression := IDENTIFIER`​ 处，其检查和类型名的检查类似

一个简单的变量名检查的例子

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

在函数定义和 for 循环中，需要特殊处理作用域。函数定义中的函数参数和 for 循环条件（括号中的内容），并不在函数/循环所在的作用域中，而在其内层作用域，在函数体/循环体作用域中，以 for 循环为例

```go
currentSymbolStackDepth := s.symbolStack.currentSymbolStackDepth
s.symbolStack.SwitchScope(currentSymbolStackDepth + 1)	// 切换到深层作用域
for i := 0; i < len(node.Children)-1; i++ {
	if err := s.Chop(node.Children[i]); err != nil {
		return err
	}
}
s.symbolStack.SwitchScope(currentSymbolStackDepth)		// 切换回当前作用域
if err := s.Chop(node.Children[len(node.Children)-1]); err != nil {
	// 如果循环体中包含 {，则会自然进入
	return err
}
s.symbolStack.EnterScope(currentSymbolStackDepth)		// 若不存在循环体，则会导致深层作用域无法弹出，这里强行重置一下
```