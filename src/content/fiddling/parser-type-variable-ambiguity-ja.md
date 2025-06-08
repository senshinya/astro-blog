---
title: 構文解析における型名と変数名の曖昧性解消
lang: ja
published: 2025-03-15T20:35:00+08:00
tags: ["試行錯誤","コンパイラ原理","構文解析","曖昧性解消"]
abbrlink: fiddling/parser-type-variable-ambiguity
description: "構文解析の過程で、ユーザー定義の型名と通常の変数名が混同される問題は大きな課題となっています。特に `a*b;` のような文は、数学的な式として解釈される場合もあれば、型宣言として扱われる場合もあります。この曖昧さは文法規則の設計に起因し、特に型指定子に関わる部分で変数名が型名と誤認されることがあり、コードの正確性と可読性に影響を及ぼします。初期化されていない変数定義が一般的になるにつれて、この問題はソースコード内でより顕著になっています。"
---
### はじめに

構文解析段階ではシンボルテーブルを保持しないため、ユーザー定義型名（typedef）と通常の変数名を区別することが困難です。関数本体内の `a*b;` という文は、a と b の積として解釈されることもあれば、型 `a*` の変数 b の宣言として解釈されることもあります。

また、以下のような文法規則が存在します。

```
declaration := declaration_specifiers SEMICOLON
declaration_specifiers := type_specifier declaration_specifiers
type_specifier := INT
type_specifier := typedef_name
typedef_name := IDENTIFIER
```

規則1は、識別子を指定しない構造体の前方宣言に多く用いられます。例えば `struct Node;` は `struct Node` 型の前方宣言を意味します。この規則の存在により、`int a;` のような文も規則1で還元される可能性があり、記号 a がユーザー定義型名として認識され、変数名として扱われないことがあります。初期化されていない変数定義がソースコードに多数現れるため、一つのソースコードに対して多数の文法規則を満たすASTが生成されてしまいます。この問題は意味解析段階でシンボルテーブルを用いて解決可能ですが、構文解析段階でも比較的低コストで事前に処理し、意味解析で扱うASTの数を減らすことが可能です。

### アプローチ

このような型名と変数名の曖昧性については、GLRパーサの実行中または実行後に、低コストな簡易シンボルテーブルを維持して誤った分岐を剪定する方法が考えられます。このシンボルテーブルは少なくとも変数名とユーザー定義型名を管理し、さらに深いスコープの変数や型名が浅いスコープのシンボルを隠蔽するため、シンボルのスコープも追跡する必要があります。

やるべきことは非常にシンプルです：

1. シンボルテーブルを維持し、型定義と変数宣言を収集する
2. シンボルを追加する際、同一スコープ内に同名の変数宣言や型定義がないか検証する
3. `primary_expression := IDENTIFIER` で還元されるノードに対し、その `IDENTIFIER` が定義済みかつ隠蔽されていない変数名かをチェックする
4. `typedef_name := IDENTIFIER` で還元されるノードに対し、その `IDENTIFIER` が定義済みかつ隠蔽されていないユーザー定義型名かをチェックする

代表的な例 `a*b;` を考えます：

```c
// 例1
typedef int a;
func test_func()
{
	a*b;
}
```

```c
// 例2
typedef int a;
func test_func()
{
	int a;
	a*b;
}
```

例1では、`a*b;` を解析する際、シンボルテーブルのレベル1（最外層）にユーザー定義型 a が存在し、レベル2（関数内）にはシンボルがありません。`a*b;` を型 `a*` の変数 b の宣言として解釈するASTでは、a は `typedef_name := IDENTIFIER` で還元され、シンボルテーブルでレベル1に型名 a が存在することが確認されるため、このASTは保持されます。一方、a と b の積として解釈するASTでは、a は `primary_expression := IDENTIFIER` で還元され、シンボルテーブルに変数 a が存在しないため、このASTは破棄されます。

例2では、`a*b;` を解析する際、レベル1に型名 a、レベル2に変数 a が存在し、変数 a が型名 a を隠蔽しています。型 `a*` の変数 b の宣言として解釈するASTでは、a は `typedef_name := IDENTIFIER` で還元され、シンボルテーブルでレベル2の a は変数であり型名ではないため、このASTは破棄されます。積として解釈するASTでは、a は `primary_expression := IDENTIFIER` で還元され、変数 a が存在するため、このASTは保持されます。

完全なシンボルテーブルと比較して、簡易シンボルテーブルは同一スコープ内の同種の変数名の重複は検査しません（ユーザー定義型名の重複は検査可能）。前方宣言が存在するため、同一変数の複数回の宣言は合法ですが、初期化を伴う宣言は一度だけ許されます。構文解析段階で初期化の有無を判別するコストは高いため、意味解析段階に委ねることが推奨されます。また、コストの関係で型チェックもこの段階では行いません。

GLR実行中に簡易シンボルテーブルを維持する場合、関数パラメータやforループ内の変数宣言の扱いが難しいです。これらの変数のスコープはより深い階層にあり、スコープの開始と終了が単純に波括弧の範囲と一致しません。関数定義の還元は必ず左右の波括弧を先に読み込んでから行われるため、波括弧の読み込み時にスコープを処理することが困難です。複数のシンボルスタックを総合的に見て判断する必要があります。これはGLRがASTをボトムアップで構築するため、葉ノードから順に根ノードを作る構造であり、ノードの文脈を把握しにくいことに起因します。

GLR実行後にAST森を走査して個別のASTを検査・除外する方法は比較的簡単です。実行中に剪定できないため時間・空間コストは高くなりますが、実装が単純であるという利点があります。実際の実装では、実行中の剪定と実行後の除外を組み合わせることが可能です。実行中の剪定はコストが低く、成功すれば実行後の除外で扱うAST数を減らせます。実行後の除外は必ず曖昧性を解消できるため、実行中の剪定は「誤って除外しないこと」を優先すべきです。

### AST構築中

AST構築中に、シンボルの読み込みや還元時にノードに情報を格納し上位に伝搬させることで、後続のトップダウン処理で情報を素早く取得できます。この曖昧性処理のために、以下の2つのフラグを追加しました。

```go
type GLRLabel struct {
	// Declarationで使用し、Declaration還元時に消去
	TypeDef      bool     // typedefかどうか
	DeclaratorID []*Token // 含まれる識別子
}
```

typedefフラグはこの宣言が型定義かどうかを示します。最終的にdeclarationに還元された際にこのフラグがなければ、通常の変数宣言と判断します。DeclaratorIDはこの宣言で定義された識別子の集合で、型定義ならばユーザー定義型名が含まれます。function_definitionの関数名もdeclarationに類似したdeclaratorで処理されるため（`function_definition := declaration_specifiers declarator compound_statement`）、DeclaratorIDには関数名も含まれます。

これらのフラグはAST構築時に下位ノードから上位ノードへ伝搬されます。

```go
gslice.ForEach(children, func(child *AstNode) {
    if child.TypeDef {
        parent.TypeDef = true
    }
    parent.DeclaratorID = append(parent.DeclaratorID, child.DeclaratorID...)
})
```

では、どの場面でこれらのフラグを設定するか？

typedefは明確で、`storage_class_specifier := TYPEDEF` で還元される際に現在のノードのTypeDefをtrueに設定します。

DeclaratorIDはやや複雑で、基本的には `direct_declarator := IDENTIFIER` で設定します。さらに列挙定数のために `enumeration_constant := IDENTIFIER` の処理も必要です。

ただし、これらのフラグを無制限に伝搬させることはできません。AST構築後にトップダウンで特定ノードを処理する際には、その階層の情報のみを扱い、下位ノードの情報が混在しないようにする必要があります（C言語のスコープ制約により、情報は上位から下位へ伝わり、下位から上位へは影響しません）。そのため、特定ノードの還元時にフラグをクリアし、伝搬を遮断します。

伝搬遮断のタイミングは、`declaration` や `function_definition` の還元時だけでなく、`direct_declarator` の還元時も含みます。特に `direct_declarator := direct_declarator LEFT_PARENTHESES parameter_type_list RIGHT_PARENTHESES` のような還元では、右側の `direct_declarator` のDeclaratorIDのみを伝搬し、`parameter_type_list` 内の関数パラメータ宣言の影響を避けます。

AST構築中に確実に行えるチェックは以下の2つです。

1. ユーザー定義型の使用時に、事前に宣言された型かを確認する（変数の隠蔽は検査不可）
2. `declaration_specifiers` にユーザー定義型の `type_specifier` が含まれる場合、それが唯一の `type_specifier` であること（ユーザー定義型は完全な型であり、他の型指定子と併用すべきでない）

1つ目のチェックは、ユーザー定義型のシンボルスタックを構築中に維持し、`{` 読み込み時に新スコープをプッシュ、`}` 読み込み時にポップします。declaration還元時にTypeDefフラグがあれば、そのDeclaratorIDをスタックトップのスコープに追加します。`typedef_name := IDENTIFIER` で還元されるノードは、既に定義済みのユーザー定義型であることを示し、スタックトップからボトムへ検索します。

2つ目のチェックは簡単で、`declaration`、`function_definition`、`parameter_declaration` の還元時に `declaration_specifiers` を検査します。

### AST構築後

上述の方法で構築を終えた後、構築中のチェックはユーザー定義型のみ扱い、変数名は扱わないため、以下のような誤りや曖昧性は依然として残ります。

```c
typedef int a;
int main() {
	int a;
	a c;	// 型 a は変数 a に隠蔽されており、この宣言は不正
}
```

そのため、構築後にはより包括的なシンボルテーブルを維持し、各スコープで型名と変数名の両方を記録します。

```go
type ScopeSymbols struct {
	TypeNames map[string]*entity.Token
	VarNames  map[string]*entity.Token
}
```

構築中のチェックと同様に、`{` 読み込み時に新スコープをプッシュ、`}` 読み込み時にポップします。declarationノードでTypeDefフラグがあれば、DeclaratorIDをスコープの型名に追加し、そうでなければ変数名に追加します。変数名追加時には同一スコープに同名の型名が存在しないかをチェックし、存在すればエラーを返します。逆に型名追加時も同様に変数名の重複をチェックします。

さらに、関数定義の関数名も変数シンボルとしてシンボルテーブルに追加します。関数定義は `function_definition := declaration_specifiers declarator ...` の形であり、declaratorのDeclaratorIDが関数名です。

次に、ユーザー定義型名と変数名の使用箇所を検査します。ユーザー定義型は `typedef_name := IDENTIFIER` のみで使用され、AST構築中に既に定義済みか検査済みです。構築後の検査では、型名が変数名に隠蔽されていないか、より深いスコープで隠蔽されていないかを追加で検査します。変数名は `primary_expression := IDENTIFIER` で使用され、型名の検査と同様に行います。

変数名検査の簡単な例：

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

関数定義やforループではスコープの特別な扱いが必要です。関数定義のパラメータやforループの条件（括弧内の内容）は関数やループのスコープではなく、より深い内側のスコープに属します。関数本体やループ本体のスコープではありません。forループを例にすると、

```go
currentSymbolStackDepth := s.symbolStack.currentSymbolStackDepth
s.symbolStack.SwitchScope(currentSymbolStackDepth + 1)	// 深いスコープに切り替え
for i := 0; i < len(node.Children)-1; i++ {
	if err := s.Chop(node.Children[i]); err != nil {
		return err
	}
}
s.symbolStack.SwitchScope(currentSymbolStackDepth)		// 元のスコープに戻す
if err := s.Chop(node.Children[len(node.Children)-1]); err != nil {
	// ループ本体に { が含まれていれば自然に入る
	return err
}
s.symbolStack.EnterScope(currentSymbolStackDepth)		// ループ本体がなければ深いスコープが抜けられず、ここで強制的にリセット
```