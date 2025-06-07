---
title: Deep Copying Between Different Types of Structs in Golang
tags: ["fiddling","golang","reflection","deep copy"]
lang: en
published: 2022-08-15T01:05:01+08:00
abbrlink: fiddling/golang-deepcopy-between-different-type
description: "During system refactoring, converting between entities at different layers in a layered architecture can be challenging, especially when it comes to deep copying. Take products as an example: the Product VO at the view layer, the Product entity at the domain layer, and the Product PO at the persistence layer all have similar but subtly distinct structures. Minor differences, such as varying data types, often make direct conversions difficult and cumbersome. To address this, I explored using reflection to create a general conversion method, aiming to simplify this process, cut down on tedious assembler functions, and improve code maintainability and flexibility."
---
I've been swamped lately with system refactoring—my blog has been left unattended for quite some time!

During the refactor, I ran into a particularly tricky problem: converting entities between different layers in a layered architecture. For example, when dealing with products, you might have a Product VO at the view layer, a Product entity or Domain Object (DO) at the domain layer, and a Product PO mapping to the database at the persistence layer...

These entity structures are often very similar—sometimes almost identical or even exactly the same—but there are often small differences. For instance, a field might be a pointer in one struct but a non-pointer in another, making direct type conversion impossible. This usually leads to creating a bunch of assembler methods to handle conversions between entities, and dealing with complex structures can turn into a nightmare. At its core, what we want is a deep copy, but type mismatches make things much more complicated.

So, I wondered if reflection could help here, allowing me to write a generic conversion method for these scenarios. After spending an afternoon experimenting, I came up with the following code:

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
        // Allow src to be a pointer and dst a non-pointer
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
        // time.Time needs special handling
        t, ok := src.Interface().(time.Time)
        if ok {
            dst.Set(reflect.ValueOf(t))
            return
        }
        if dst.Kind() == reflect.Ptr {
            // Destination is a pointer but source is not
            copyValue := reflect.New(dst.Type().Elem()).Elem()
            copyRecursive(src, copyValue)
            dst.Set(copyValue.Addr())
            return
        }
        for i := 0; i < dst.NumField(); i++ {
            if dst.Type().Field(i).PkgPath != "" {
                // Skip unexported fields
                continue
            }
            field := src.FieldByName(dst.Type().Field(i).Name)
            if !field.IsValid() {
                // Field doesn't exist in the source, skip (destination gets zero value)
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
        // Base types
        // If the types differ but share the same underlying type, perform conversion
        if dst.Kind() == reflect.Ptr {
            // Destination is a pointer but source is not
            copyValue := reflect.New(dst.Type().Elem()).Elem()
            copyRecursive(src, copyValue)
            dst.Set(copyValue.Addr())
            return
        }
        dst.Set(src.Convert(dst.Type()))
    }
}
```

The key is the `copyRecursive` function, which supports deep copying for structs, slices, and maps. It also allows copying between pointer and non-pointer types in both directions. The only requirement is that when copying structs, every field in the destination struct must have a counterpart in the source struct with the same name and the same underlying type—only then can the recursive deep copy succeed.

I'm not going to dig into the nitty-gritty details of the code, but I have to say this:

Reflection is seriously powerful.

---

Update 2022-08-20: Now supports copying to structs where certain fields do not exist in the source struct. If a field is missing in the source struct, the corresponding field in the destination struct will be set to its zero value (nil for pointers, an empty struct for structs).