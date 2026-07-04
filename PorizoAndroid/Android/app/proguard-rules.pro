# Native Android release rules. Keep this file free of legacy bridge rules.
#
# Retrofit creates API implementations from annotated interfaces at runtime.
# Keep the service interface and the metadata Retrofit/Moshi need after R8.
-keep interface com.porizo.core.network.PorizoApiService { *; }
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,AnnotationDefault,Signature,InnerClasses,EnclosingMethod
