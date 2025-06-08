---
title: golangで異なる型の構造体間の深いコピーをサポートする
tags: ["試行錯誤","golang","リフレクション","深いコピー"]
lang: ja
published: 2022-08-15T01:05:01+08:00
abbrlink: fiddling/golang-deepcopy-between-different-type
description: "システムのリファクタリング過程で、階層化アーキテクチャにおける異なるエンティティ間の変換問題に直面し、深いコピーが課題となりました。商品を例にとると、ビュー層の商品VO、ドメイン層のエンティティ、ストレージ層のPO構造体は似ていますが、データ型の微妙な違いなどがあり、直接の変換が複雑で面倒です。そこでリフレクションを使って汎用的な変換メソッドを実装し、このプロセスを簡素化し、煩雑なアセンブラメソッドを減らし、コードの保守性と柔軟性を向上させることを目指しました。"
---
最近システムのリファクタリングをしていて、忙しくてブログをしばらく放置していました。

リファクタリング中に非常に厄介な問題に直面しました。それは階層化アーキテクチャにおける異なる層のエンティティ間の相互変換です。例えば商品を例にとると、ビュー層には商品VOがあり、ドメイン層には商品エンティティ（またはDO：ドメインオブジェクト）があり、ストレージ層にはデータベースのエンティティに対応する商品POが存在するかもしれません。

これらのエンティティ構造はほとんど似ていて、多くは基本的に同じか完全に同一ですが、例えばあるフィールドが一方のエンティティではポインタ型で、もう一方ではポインタ型でないなどの細かな違いがあり、そのため直接の型変換ができません。多くのアセンブラメソッドを書いてエンティティを変換する必要があり、複雑な構造になるとまさに地獄です。本質的には深いコピーなのに、型が一致しないために扱えないのです。

そこでリフレクションを使ってこの問題を解決できないかと考え、この特殊なケースに対応する汎用的な変換メソッドを作ろうと、午後を丸々費やして以下のコードを書きました。

```go
func Copy(src interface{}, dstType interface{}) interface{} {
    if src == nil {
        return nil
    }
    cpy := reflect.New(reflect.TypeOf(dstType)).Elem()
    copyRecursive(reflect.ValueOf(src), cpy)
    return cpy.Interface()
}
 
func copyRecursive(src, dst reflect.Value) {
    switch src.Kind() {
    case reflect.Ptr:
        originValue := src.Elem()
        if !originValue.IsValid() {
            return
        }
        // srcがポインタでdstが非ポインタでも許容
        if dst.Kind() == reflect.Ptr {
            dst.Set(reflect.New(dst.Type().Elem()))
            copyRecursive(originValue, dst.Elem())
        } else {
            dst.Set(reflect.New(dst.Type()).Elem())
            copyRecursive(originValue, dst)
        }
    case reflect.Interface:
        if src.IsNil() {
            return
        }
        originValue := src.Elem()
        copyValue := reflect.New(dst.Type().Elem()).Elem()
        copyRecursive(originValue, copyValue)
        dst.Set(copyValue)
    case reflect.Struct:
        // time.Time は特別扱いが必要
        t, ok := src.Interface().(time.Time)
        if ok {
            dst.Set(reflect.ValueOf(t))
            return
        }
        if dst.Kind() == reflect.Ptr {
            // 目的の型がポインタで、元の型がポインタでない場合
            copyValue := reflect.New(dst.Type().Elem()).Elem()
            copyRecursive(src, copyValue)
            dst.Set(copyValue.Addr())
            return
        }
        for i := 0; i < dst.NumField(); i++ {
            if dst.Type().Field(i).PkgPath != "" {
                // 非公開フィールドはコピーしない
                continue
            }
            field := src.FieldByName(dst.Type().Field(i).Name)
            if !field.IsValid() {
                // 元のフィールドが存在しない場合は無視（目的は自動的にゼロ値）
                continue
            }
            copyRecursive(field, dst.Field(i))
        }
    case reflect.Slice:
        if src.IsNil() {
            return
        }
        dst.Set(reflect.MakeSlice(dst.Type(), src.Len(), src.Cap()))
        for i := 0; i < src.Len(); i++ {
            copyRecursive(src.Index(i), dst.Index(i))
        }
    case reflect.Map:
        if src.IsNil() {
            return
        }
        dst.Set(reflect.MakeMap(dst.Type()))
        for _, key := range src.MapKeys() {
            value := src.MapIndex(key)
            copyValue := reflect.New(dst.Type().Elem()).Elem()
            copyRecursive(value, copyValue)
            copyKey := Copy(key.Interface(), reflect.New(dst.Type().Key()).Elem().Interface())
            dst.SetMapIndex(reflect.ValueOf(copyKey), copyValue)
        }
    default:
        // 元の型が基本型の場合
        // 型が異なっても基底型が同じ基本型は強制変換する
        if dst.Kind() == reflect.Ptr {
            // 目的の型がポインタで、元の型がポインタでない場合
            copyValue := reflect.New(dst.Type().Elem()).Elem()
            copyRecursive(src, copyValue)
            dst.Set(copyValue.Addr())
            return
        }
        dst.Set(src.Convert(dst.Type()))
    }
}
```

ポイントは copyRecursive 関数で、構造体、スライス、マップの深いコピーをサポートし、ポインタ型から非ポインタ型、非ポインタ型からポインタ型へのコピーも可能にしています。ただし構造体をコピーする際は、目的の構造体の全フィールドが元の構造体に同名かつ基底型が同じフィールドとして存在している必要があり、そうすることで再帰的な深いコピーが完成します。

細かいコードの仕組みは割愛しますが、ひとこと言いたいのは、

リフレクションは本当にすごい

---

20220820 更新：元の構造体に同名フィールドが存在しない構造体へのコピーをサポートしました。元の構造体に同名フィールドがない場合、目的の構造体のフィールドはゼロ値（ポインタはnil、構造体は空構造体）で初期化されます。