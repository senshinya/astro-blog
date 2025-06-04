---
title: golang 支持不同类型结构体间的深拷贝
tags: ["折腾","golang","反射","深拷贝"]
published: 2022-08-15T01:05:01+08:00
description: "在系统重构的过程中，面对分层架构中不同实体间的转换问题，深拷贝成为一项挑战。以商品为例，视图层的商品 VO、领域层的商品 entity 以及存储层的商品 PO 结构虽相似，但细微的差别如数据类型的不同，常常使得直接转换变得复杂且麻烦。为此，尝试利用反射实现一个通用的转换方法，旨在简化这一过程，减少繁琐的 assembler 方法，提升代码的可维护性与灵活性。"
---
最近在做系统重构，忙得不可开交～博客荒废了好一阵子

在重构时，遇到了一个很恶心的事情：分层架构中不同层实体的互相转换。以商品为例，在视图层可能存在一个商品 VO，在领域层有个商品 entity 或者叫 DO（domain object），在存储层还可能有个商品 PO 对应着数据库实体……

这些实体结构大都很像，甚至好多基本一致或完全一样，或存在着细微的区别，例如某个字段在这个实体中是指针类型，而在另外的结构中则不是指针类型，因而导致无法直接强转，比如写很多 assembler 方法来对实体做转换，遇到复杂结构简直就是地狱。本质上就是深拷贝，就因为类型不一致而没法处理。

于是想着能不能用反射解决一下问题，对于这种特殊的场景做一个通用一点的转换方法，于是花了一个下午，以下代码应运而生：

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
        // 允许 src 为 ptr 而 dst 为非 ptr
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
        // time.Time 需要特殊处理
        t, ok := src.Interface().(time.Time)
        if ok {
            dst.Set(reflect.ValueOf(t))
            return
        }
        if dst.Kind() == reflect.Ptr {
            // 目标类型是指针而源类型不是指针
            copyValue := reflect.New(dst.Type().Elem()).Elem()
            copyRecursive(src, copyValue)
            dst.Set(copyValue.Addr())
            return
        }
        for i := 0; i < dst.NumField(); i++ {
            if dst.Type().Field(i).PkgPath != "" {
                // 不可导出的字段不拷贝
                continue
            }
            field := src.FieldByName(dst.Type().Field(i).Name)
            if !field.IsValid() {
                // 源字段不存在，忽略（目标自动零值）
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
        // 源类型是基础类型
        // 类型不一致但底层类型一致的基本类型，需要强转
        if dst.Kind() == reflect.Ptr {
            // 目标类型是指针而源类型不是指针
            copyValue := reflect.New(dst.Type().Elem()).Elem()
            copyRecursive(src, copyValue)
            dst.Set(copyValue.Addr())
            return
        }
        dst.Set(src.Convert(dst.Type()))
    }
}
```

核心在于 copyRecursive 方法，它支持处理结构体、Slice 和 Map 的深拷贝，并且支持从指针类型向非指针类型、非指针类型向指针类型的拷贝，唯一的要求就是拷贝结构体时，目标类型结构体中的所有字段都必须在源类型结构体中有同名且底层类型相同的字段，这样才能完成递归深拷贝。

具体代码原理不细细讲解，但是我还是要说一句：

反射确实很牛逼

---

20220820 update：支持拷贝到源结构体中不存在同名字段的结构体，当源结构体不存在同名字段时，目标结构体的字段会被赋零值（指针为 nil，结构体为空结构体）