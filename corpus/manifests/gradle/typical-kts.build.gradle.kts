plugins {
    alias(libs.plugins.android.application)
    kotlin("android")
}

android {
    namespace = "com.example.app"
    compileSdk = 34
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.compose.material3:material3:1.2.1")
    implementation(platform("androidx.compose:compose-bom:2024.05.00"))
    implementation(libs.androidx.lifecycle.runtime)
    implementation(project(":core"))
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
}
